import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password, remember);
      navigate("/");
    } catch {
      setError("Invalid credentials");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back! Please enter your details."
      footer={
        <p className="text-sm text-muted mt-6 text-center">
          Don't have an account?{" "}
          <Link to="/register" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Register
          </Link>
        </p>
      }
    >
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm mb-4" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-ink mb-1">
            Username
          </label>
          <input
            id="username"
            type="text"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink mb-1">
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-indigo-600 dark:text-indigo-400 focus:ring-indigo-500"
            />
            Remember me
          </label>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}
