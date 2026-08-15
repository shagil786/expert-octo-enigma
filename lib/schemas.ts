import { z } from "zod";

// Schemas are shared between client (React Hook Form resolver) and server (Route Handler validation),
// so the same rules apply in both places and field errors map cleanly back to the form.

/**
 * Real http(s) media-URL validator.
 *
 * Rejects:
 *  - empty / non-string values
 *  - non-URL garbage ("not a url")
 *  - non-http(s) schemes ("ftp://…", "file://…", "javascript:…")
 *  - a bare host with no path ("https://example.com")
 *  - URLs that have no path segment (root "/")
 */
export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, "Source URL is required")
  .refine(
    (value) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      // Require an actual path (more than just "/") so a bare host is rejected.
      return parsed.pathname.length > 1;
    },
    "Enter a valid http(s) media URL",
  );

export const createJobSchema = z.object({
  sourceUrl: sourceUrlSchema,
  title: z
    .string()
    .trim()
    .max(80, "Keep the title under 80 characters")
    .optional()
    .or(z.literal("")),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const startRunSchema = z.object({
  jobId: z.string().min(1, "jobId is required"),
});