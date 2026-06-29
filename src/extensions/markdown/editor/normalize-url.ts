/**
 * Normalize a user-entered link target into a usable `href`.
 *
 * - Values that already carry a scheme (`https://…`, `mailto:`, `tel:`, …) are
 *   returned untouched.
 * - Anchors (`#section`) and relative paths (`/docs`, `./intro.md`,
 *   `../page`) pass through as-is.
 * - Bare email addresses become `mailto:` links.
 * - Everything else is treated as an external link and gets an `https://` prefix.
 *
 * Returns `null` for empty input so callers can bail out early.
 *
 * @example
 * normalizeUrl("superset.sh")        // "https://superset.sh"
 * normalizeUrl("hi@example.com")     // "mailto:hi@example.com"
 * normalizeUrl("/docs")              // "/docs"
 * normalizeUrl("./intro.md")         // "./intro.md"
 * normalizeUrl("")                   // null
 */
export function normalizeUrl(input: string): string | null {
	const value = input.trim();
	if (!value) return null;

	// Already a fully-qualified URL: scheme://host
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
	// Schemes without an authority component
	if (/^(mailto|tel|sms|ftp):/i.test(value)) return value;
	// Anchor or relative path — leave the author in control
	if (
		value.startsWith("#") ||
		value.startsWith("/") ||
		value.startsWith("./") ||
		value.startsWith("../")
	) {
		return value;
	}
	// Looks like a bare email address
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;

	// Default: an external link missing its protocol
	return `https://${value}`;
}
