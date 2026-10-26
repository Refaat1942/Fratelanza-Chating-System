import { Link } from "wouter";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states";

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <EmptyState
        icon={<SearchX className="h-10 w-10" />}
        title="Page not found"
        hint="The page you are looking for does not exist or was moved."
        action={
          <Button asChild>
            <Link href="/chat">Go to Inbox</Link>
          </Button>
        }
      />
    </div>
  );
}
