import json
import os
from dagster import ConfigurableIOManager

class JSONIOManager(ConfigurableIOManager):
    base_dir: str = "dagster_data"

    def handle_output(self, context, obj):
        os.makedirs(self.base_dir, exist_ok=True)
        path = os.path.join(self.base_dir, f"{context.asset_key.path[-1]}.json")
        with open(path, "w") as f:
            json.dump(obj, f)

    def load_input(self, context):
        path = os.path.join(self.base_dir, f"{context.asset_key.path[-1]}.json")
        with open(path, "r") as f:
            return json.load(f)

json_io_manager = JSONIOManager()
