import asyncio
import json
import subprocess
from pathlib import Path
from typing import Any

from dagster import AssetCheckResult, Config, asset, asset_check

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR / "../../../"
NODE_BIN = "node"
COMMAND_TIMEOUT_SECONDS = 120


class AnalyzeConfig(Config):
    target_path: str


def package_script(*parts: str) -> str:
    return str((REPO_ROOT / Path(*parts)).resolve())


def parse_json_output(stdout: str, source: str) -> dict[str, Any]:
    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{source} returned invalid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError(f"{source} returned JSON that is not an object.")

    return parsed


def run_node_json(script_path: str, args: list[str], source: str) -> dict[str, Any]:
    try:
        result = subprocess.run(
            [NODE_BIN, script_path, *args],
            capture_output=True,
            text=True,
            check=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
        )
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        raise RuntimeError(f"{source} failed with exit code {exc.returncode}: {stderr}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{source} timed out after {COMMAND_TIMEOUT_SECONDS}s") from exc

    return parse_json_output(result.stdout, source)


async def run_node_json_async(script_path: str, args: list[str], source: str) -> dict[str, Any]:
    proc = await asyncio.create_subprocess_exec(
        NODE_BIN,
        script_path,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=COMMAND_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise RuntimeError(f"{source} timed out after {COMMAND_TIMEOUT_SECONDS}s")

    stdout_text = stdout.decode("utf-8", errors="replace")
    stderr_text = stderr.decode("utf-8", errors="replace").strip()

    if proc.returncode != 0:
        raise RuntimeError(f"{source} failed with exit code {proc.returncode}: {stderr_text}")

    return parse_json_output(stdout_text, source)


@asset
def project_analysis(config: AnalyzeConfig) -> dict[str, Any]:
    script_path = package_script("packages", "project-analyzer", "dist", "index.js")
    return run_node_json(
        script_path,
        [config.target_path, "--output-json"],
        "project_analysis",
    )


@asset_check(asset=project_analysis)
def check_project_analysis_stack(project_analysis: dict[str, Any]) -> AssetCheckResult:
    stack = project_analysis.get("stack")
    has_stack = isinstance(stack, dict) and isinstance(stack.get("language"), str)

    return AssetCheckResult(
        passed=has_stack,
        metadata={"language": stack.get("language", "unknown")} if has_stack else {},
    )


@asset
def static_analysis_results(
    config: AnalyzeConfig,
    project_analysis: dict[str, Any],
) -> dict[str, Any]:
    script_path = package_script("packages", "static-analysis", "dist", "index.js")
    manifest_str = json.dumps(project_analysis)

    return run_node_json(
        script_path,
        [config.target_path, "--manifest", manifest_str, "--output-json"],
        "static_analysis_results",
    )


async def run_tool_adapter(adapter_name: str, target_path: str) -> dict[str, Any]:
    script_path = package_script("packages", "tool-adapters", "dist", "cli.js")

    try:
        result = await run_node_json_async(
            script_path,
            [adapter_name, target_path],
            f"tool_adapter:{adapter_name}",
        )
        return {"tool": adapter_name, "success": True, "result": result}
    except Exception as exc:
        return {"tool": adapter_name, "success": False, "error": str(exc)}


def select_tools(project_analysis: dict[str, Any]) -> list[str]:
    tools: list[str] = []

    node = project_analysis.get("node")
    if isinstance(node, dict):
        if node.get("hasEslint"):
            tools.append("eslint")
        if node.get("hasVitest"):
            tools.append("vitest")

    python = project_analysis.get("python")
    if isinstance(python, dict) and python.get("hasPytest"):
        tools.append("pytest")

    return tools


@asset
async def tool_adapter_results(
    config: AnalyzeConfig,
    project_analysis: dict[str, Any],
) -> dict[str, Any]:
    tools_to_run = select_tools(project_analysis)
    if not tools_to_run:
        return {"results": []}

    tasks = [run_tool_adapter(tool, config.target_path) for tool in tools_to_run]
    results = await asyncio.gather(*tasks)

    return {"results": results}


@asset
def final_report(
    project_analysis: dict[str, Any],
    static_analysis_results: dict[str, Any],
    tool_adapter_results: dict[str, Any],
) -> dict[str, Any]:
    script_path = package_script("packages", "report-generator", "dist", "index.js")

    return run_node_json(
        script_path,
        [
            "--project-analysis",
            json.dumps(project_analysis),
            "--static-analysis",
            json.dumps(static_analysis_results),
            "--tool-results",
            json.dumps(tool_adapter_results),
            "--output-json",
        ],
        "final_report",
    )
