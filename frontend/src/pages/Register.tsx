import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

export default function Register() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState("worker");
  const [error, setError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setConfirmError("");
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const result = await register(username, email, password, role);
      if (result && (result as any).pending) {
        setPendingApproval(true);
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Registration failed. Username or email may already exist.");
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingApproval) {
    return (
      <AuthLayout
        title="Account pending approval"
        subtitle="Your registration has been submitted successfully."
      >
        <div className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center">
            <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="text-sm text-muted">
            Your account is <strong>pending admin approval</strong>. An administrator has been notified and will review your registration.
          </p>
          <p className="text-sm text-muted">
            You will be able to sign in once your account is approved.
          </p>
          <div className="pt-4">
            <Link to="/login" className="btn-primary inline-flex items-center gap-2">
              Back to Sign In
            </Link>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Get started with your inventory workspace."
      footer={
        <p className="text-sm text-muted mt-6 text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            Sign in
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
          <label htmlFor="email" className="block text-sm font-medium text-ink mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label htmlFor="register-role" className="block text-sm font-medium text-ink mb-1">
            Role
          </label>
          <select
            id="register-role"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <p className="text-xs text-muted mt-1">An admin will review and approve your registration.</p>
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink mb-1">
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={6}
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink mb-1">
            Confirm Password
          </label>
          <PasswordInput
            id="confirmPassword"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={6}
          />
          {confirmError && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{confirmError}</p>}
        </div>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Register"}
        </button>
      </form>
    </AuthLayout>
  );
}
