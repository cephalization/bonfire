import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/AuthShell";
import { authClient, authErrorMessage } from "@/lib/auth";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Create an organization. Every VM belongs to one, so a new user with no
 * memberships is sent here first.
 */
export function CreateOrganization() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!effectiveSlug) return setError("Slug is required");

    setIsLoading(true);
    try {
      const result = await authClient.organization.create({
        name: name.trim(),
        slug: effectiveSlug,
      });
      if (result.error) {
        setError(authErrorMessage(result.error, "Could not create the organization"));
        return;
      }
      // Creating an organization makes it the session's active one.
      navigate("/", { replace: true });
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>
            VMs belong to an organization. Invite teammates to it from Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="acme"
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                A short, unique identifier. Letters, numbers and dashes.
              </p>
            </div>

            <FormError message={error} />

            <Button type="submit" disabled={isLoading} data-testid="create-org-submit">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create organization"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
