export default function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-app">
      <div className="w-full max-w-sm space-y-3">
        <div className="h-5 w-40 bg-subtle-strong rounded animate-pulse" />
        <div className="h-3 w-full bg-subtle-strong rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-subtle-strong rounded animate-pulse" />
        <div className="flex gap-2 pt-2">
          <div className="h-8 w-20 bg-subtle-strong rounded animate-pulse" />
          <div className="h-8 w-20 bg-subtle-strong rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
