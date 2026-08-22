import { collaboratorStore } from '../presence/collaboratorStore';
import { provider } from '../document';

/**
 * Format an array of reactor author IDs into human-readable collaborator names.
 * e.g., "Emma, Alex and Marcus" or "You and 2 others"
 */
export function formatVoterSummary(authorIds: string[], myAuthorId: string): string {
  if (!authorIds || authorIds.length === 0) return '';
  const collaborators = collaboratorStore.getSnapshot();
  const localUser = provider.awareness?.getLocalState()?.user as { name?: string } | undefined;
  const localName = localUser?.name || 'You';

  const names = authorIds.map((id) => {
    if (id === myAuthorId) return 'You';
    const found = collaborators.find(
      (c) => String(c.clientId) === id || c.name.toLowerCase() === id.toLowerCase()
    );
    if (found) return found.name;
    if (id === localName) return 'You';
    return id.length > 8 ? 'Collaborator' : id;
  });

  // Deduplicate names if any
  const unique = Array.from(new Set(names));

  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  if (unique.length === 3) return `${unique[0]}, ${unique[1]} and ${unique[2]}`;
  return `${unique[0]}, ${unique[1]} and ${unique.length - 2} others`;
}
