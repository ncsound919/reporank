from dagster import Definitions
from .assets import project_analysis, static_analysis_results, tool_adapter_results, final_report, check_project_analysis_stack
from .io_managers import json_io_manager

defs = Definitions(
    assets=[project_analysis, static_analysis_results, tool_adapter_results, final_report],
    asset_checks=[check_project_analysis_stack],
    resources={
        "io_manager": json_io_manager
    }
)
