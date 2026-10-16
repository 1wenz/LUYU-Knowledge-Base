import { WorkspaceEntry } from "@/features/workspace/entry";
import { Suspense } from "react";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          正在打开工作区…
        </p>
      }
    >
      <WorkspaceEntry />
    </Suspense>
  );
}
