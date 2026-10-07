// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('../../utils/observability', () => ({ reportClientError: vi.fn() }));

import { FeatureBoundary } from './FeatureBoundary';
import { isChunkLoadError } from './chunkError';
import { reportClientError } from '../../utils/observability';

let shouldThrow: Error | null = null;
function Flaky() {
  if (shouldThrow) throw shouldThrow;
  return <p>panel content</p>;
}

beforeEach(() => {
  shouldThrow = null;
  // React logs every caught render error; the boundary is the thing under test.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FeatureBoundary', () => {
  it('replaces only the part that threw, and reports it', () => {
    shouldThrow = new Error('bad chart spec');
    const { getByRole, getByText } = render(
      <div>
        <p>the board</p>
        <FeatureBoundary name="properties panel">
          <Flaky />
        </FeatureBoundary>
      </div>
    );
    expect(getByText('the board')).toBeTruthy();
    expect(getByRole('alert').textContent).toContain('The properties panel hit a problem');
    expect(reportClientError).toHaveBeenCalled();
  });

  it('tries again when its reset key changes', () => {
    shouldThrow = new Error('boom');
    const { rerender, queryByText } = render(
      <FeatureBoundary name="panel" resetKey="a">
        <Flaky />
      </FeatureBoundary>
    );
    expect(queryByText('panel content')).toBeNull();

    shouldThrow = null;
    rerender(
      <FeatureBoundary name="panel" resetKey="b">
        <Flaky />
      </FeatureBoundary>
    );
    expect(queryByText('panel content')).toBeTruthy();
  });

  it('retries on Try again', () => {
    shouldThrow = new Error('boom');
    const { getByText, queryByText } = render(
      <FeatureBoundary name="panel">
        <Flaky />
      </FeatureBoundary>
    );
    shouldThrow = null;
    fireEvent.click(getByText('Try again'));
    expect(queryByText('panel content')).toBeTruthy();
  });

  it('says a new version is available when a chunk failed to load', () => {
    shouldThrow = new TypeError('Failed to fetch dynamically imported module: /assets/HelpModal-abc.js');
    const onClose = vi.fn();
    const { getByRole, getByText } = render(
      <FeatureBoundary name="help" variant="modal" onClose={onClose}>
        <Flaky />
      </FeatureBoundary>
    );
    expect(getByRole('alertdialog').textContent).toContain('A new version of Vega is available');
    fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('draws nothing in the silent variant', () => {
    shouldThrow = new Error('boom');
    const { container } = render(
      <FeatureBoundary name="rail" variant="silent">
        <Flaky />
      </FeatureBoundary>
    );
    expect(container.innerHTML).toBe('');
  });
});

describe('isChunkLoadError', () => {
  it('recognises the messages browsers use for a missing chunk', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: x.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('does not mistake an ordinary error for one', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });
});
