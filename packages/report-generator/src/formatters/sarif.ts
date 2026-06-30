export function formatToSarif(reportData: any) {
  const results: any[] = [];
  
  // Transform tool output errors into SARIF results
  // We assume reportData.toolResults contains adapter outputs
  if (reportData.toolResults && reportData.toolResults.results) {
    for (const toolRes of reportData.toolResults.results) {
      if (toolRes.errors) {
        for (const err of toolRes.errors) {
          results.push({
            ruleId: `${toolRes.tool}-error`,
            level: "error",
            message: { text: err },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: "unknown" },
                  region: { startLine: 1 }
                }
              }
            ]
          });
        }
      }
    }
  }

  // Convert standard report JSON into OASIS SARIF v2.1.0 format
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "reporank",
            informationUri: "https://reporank.dev",
            rules: [] // Define rules if needed later
          }
        },
        results
      }
    ]
  };
}
