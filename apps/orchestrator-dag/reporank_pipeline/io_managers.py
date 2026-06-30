import json
from pathlib import Path
from typing import Any

from dagster import ConfigurableIOManager


class JSONIOManager(ConfigurableIOManager):
    base_dir: str = "dagster_data"

    def _base_path(self) -> Path:
        path = Path(self.base_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _asset_file_path(self, context) -> Path:
        asset_path = getattr(context.asset_key, "path", None)
        if not asset_path:
            raise ValueError("Asset key path is missing; cannot determine JSON storage path.")

        filename = "__".join(str(part) for part in asset_path) + ".json"
        return self._base_path() / filename

    def handle_output(self, context, obj: Any) -> None:
        path = self._asset_file_path(context)

        with path.open("w", encoding="utf-8") as file:
            json.dump(obj, file, ensure_ascii=False, indent=2, sort_keys=True)
            file.write("\n")

        if hasattr(context, "add_output_metadata"):
            context.add_output_metadata(
                {
                    "path": str(path),
                    "bytes": path.stat().st_size,
                }
            )

    def load_input(self, context) -> Any:
        upstream_output = getattr(context, "upstream_output", None)
        upstream_asset_key = getattr(upstream_output, "asset_key", None)

        if upstream_asset_key is not None:
            asset_path = getattr(upstream_asset_key, "path", None)
        else:
            asset_path = getattr(context.asset_key, "path", None)

        if not asset_path:
            raise ValueError("No upstream asset key path found; cannot load JSON input.")

        filename = "__".join(str(part) for part in asset_path) + ".json"
        path = self._base_path() / filename

        if not path.exists():
            raise FileNotFoundError(f"JSON input file not found for asset {'/'.join(asset_path)}: {path}")

        with path.open("r", encoding="utf-8") as file:
            return json.load(file)


json_io_manager = JSONIOManager()
