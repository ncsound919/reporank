import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [aiProvider, setAiProvider] = useState(localStorage.getItem("reporank_ai_provider") || "gemini");
  const [aiModel, setAiModel] = useState(localStorage.getItem("reporank_ai_model") || "");
  const [aiEndpoint, setAiEndpoint] = useState(localStorage.getItem("reporank_ai_endpoint") || "");
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    localStorage.setItem("reporank_ai_provider", aiProvider);
    localStorage.setItem("reporank_ai_model", aiModel);
    localStorage.setItem("reporank_ai_endpoint", aiEndpoint);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/dashboard" className="text-lg font-bold">RepoRank</a>
          <a href="/dashboard" className="text-sm text-gray-400 hover:text-white">Back to Dashboard</a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-12">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>

        {!user && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-8 text-yellow-400 text-sm">
            Sign in to save settings and access scan history.
          </div>
        )}

        {/* AI Provider Configuration */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-lg font-semibold mb-4">🧠 AI Provider</h2>
          <p className="text-sm text-gray-400 mb-6">Choose where AI grading runs. Local providers keep your code private.</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">Provider</label>
              <select value={aiProvider} onChange={e => setAiProvider(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white">
                <option value="gemini">Gemini (Cloud)</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="lmstudio">LM Studio (Local)</option>
              </select>
            </div>

            {aiProvider !== "gemini" && (
              <>
                <div>
                  <label className="block text-sm text-gray-300 mb-2">Model Name</label>
                  <input type="text" value={aiModel} onChange={e => setAiModel(e.target.value)}
                    placeholder={aiProvider === "ollama" ? "llama3, mistral, codellama..." : "Leave empty for default"}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500" />
                  <p className="text-xs text-gray-500 mt-1">For Ollama: the model tag (e.g., llama3, codellama, mistral)</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-2">API Endpoint</label>
                  <input type="text" value={aiEndpoint} onChange={e => setAiEndpoint(e.target.value)}
                    placeholder={aiProvider === "ollama" ? "http://localhost:11434" : "http://localhost:1234"}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500" />
                  <p className="text-xs text-gray-500 mt-1">The URL where your local AI server is running</p>
                </div>
              </>
            )}

            {aiProvider === "gemini" && (
              <div className="bg-gray-800/50 rounded-lg p-4 text-sm text-gray-400">
                Gemini runs on Google's cloud servers. Your code analysis data is sent to the Gemini API.
                For private analysis, choose Ollama or LM Studio.
              </div>
            )}

            <button onClick={saveSettings}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-6 py-3 rounded-xl transition-colors">
              {saved ? "✓ Saved!" : "Save Settings"}
            </button>
          </div>
        </div>

        {/* Account */}
        {user && (
          <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
            <h2 className="text-lg font-semibold mb-4">Account</h2>
            <p className="text-sm text-gray-400 mb-2">{user.email}</p>
            <p className="text-sm text-gray-500 mb-4">Scans this month: {user.scansThisMonth}</p>
            <button onClick={logout}
              className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm hover:bg-red-500/20 transition-colors">
              Sign Out
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
