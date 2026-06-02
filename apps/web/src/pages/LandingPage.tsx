import { useState } from "react";
import { useNavigate } from "react-router";
import { Scan, Shield, Sparkles } from "lucide-react";

export default function LandingPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (repoUrl.trim()) {
      navigate(`/dashboard?url=${encodeURIComponent(repoUrl.trim())}`);
    } else {
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-gray-900 to-gray-950">
      <header className="border-b border-gray-800/50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-400" />
            <span className="text-lg font-bold">RepoRank</span>
          </div>
          <a href="/dashboard" className="bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium transition-colors">Sign In</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-24 pb-32 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 text-emerald-400 text-sm mb-8">
          <Sparkles className="w-4 h-4" /> Google Analytics for your codebase
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent">
          Know exactly where<br />your codebase stands
        </h1>

        <p className="text-lg text-gray-400 mb-12 max-w-2xl mx-auto">
          Grade any GitHub repo across 8 dimensions — security, quality, vibe, architecture, and more.
          Get a score, missing pieces map, and an AI-generated fix pack.
        </p>

        <form onSubmit={handleSubmit} className="max-w-xl mx-auto flex gap-3">
          <div className="flex-1 relative">
            <Scan className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
            <input type="text" value={repoUrl} onChange={e => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-xl px-12 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all" />
          </div>
          <button type="submit"
            className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-8 py-4 rounded-xl transition-colors flex items-center gap-2">
            Grade It
          </button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-6 text-sm text-gray-500">
          <span>Free for public repos</span>
          <span className="w-1 h-1 rounded-full bg-gray-600" />
          <span>No account required</span>
          <span className="w-1 h-1 rounded-full bg-gray-600" />
          <span>2-min analysis</span>
        </div>
      </main>
    </div>
  );
}
