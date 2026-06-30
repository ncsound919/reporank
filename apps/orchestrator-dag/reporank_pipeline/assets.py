import json
import asyncio
import subprocess
import os
from dagster import asset, Config

class AnalyzeConfig(Config):
    target_path: str

@asset
def project_analysis(config: AnalyzeConfig) -> dict:
    # Run project analyzer
    # Assumes we run this from a location where paths map correctly, e.g. monorepo root
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../packages/project-analyzer/dist/index.js"))
    result = subprocess.run(
        ["node", script_path, config.target_path, "--output-json"],
        capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)

from dagster import asset_check, AssetCheckResult

@asset_check(asset=project_analysis)
def check_project_analysis_stack(project_analysis):
    has_stack = "stack" in project_analysis and "language" in project_analysis["stack"]
    return AssetCheckResult(
        passed=has_stack,
        metadata={"language": project_analysis.get("stack", {}).get("language", "unknown")} if has_stack else {}
    )

@asset
def static_analysis_results(config: AnalyzeConfig, project_analysis: dict) -> dict:
    manifest_str = json.dumps(project_analysis)
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../packages/static-analysis/dist/index.js"))
    result = subprocess.run(
        ["node", script_path, config.target_path, "--manifest", manifest_str, "--output-json"],
        capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)

async def run_tool_adapter(adapter_name: str, target_path: str) -> dict:
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../packages/tool-adapters/dist/cli.js"))
    proc = await asyncio.create_subprocess_exec(
        "node", script_path, adapter_name, target_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return {"tool": adapter_name, "success": False, "error": stderr.decode()}
    return json.loads(stdout.decode())

@asset
async def tool_adapter_results(config: AnalyzeConfig, project_analysis: dict) -> dict:
    tools_to_run = []
    if project_analysis.get('node', {}).get('hasEslint'): tools_to_run.append('eslint')
    if project_analysis.get('node', {}).get('hasVitest'): tools_to_run.append('vitest')
    if project_analysis.get('python', {}).get('hasPytest'): tools_to_run.append('pytest')
    
    tasks = [run_tool_adapter(t, config.target_path) for t in tools_to_run]
    results = await asyncio.gather(*tasks)
    return {"results": results}

@asset
def final_report(project_analysis: dict, static_analysis_results: dict, tool_adapter_results: dict) -> dict:
    pa_str = json.dumps(project_analysis)
    sa_str = json.dumps(static_analysis_results)
    ta_str = json.dumps(tool_adapter_results)
    
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../packages/report-generator/dist/index.js"))
    result = subprocess.run(
        ["node", script_path, "--project-analysis", pa_str, "--static-analysis", sa_str, "--tool-results", ta_str, "--output-json"],
        capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)
