import { describe, it, expect } from 'vitest';
import { ancestorsOf } from '../../engine/model/groupTree';
import { useStore } from '../../hooks/useStore';

describe('GroupIsolationBar state & ancestry resolution', () => {
  it('resolves breadcrumb chain for nested groups correctly', () => {
    const groups = {
      'root-group': { id: 'root-group', name: 'Layout' },
      'mid-group': { id: 'mid-group', parentId: 'root-group', name: 'Cards' },
      'leaf-group': { id: 'leaf-group', parentId: 'mid-group', name: 'Card 1' },
    };

    useStore.setState({
      groups,
      enteredGroupId: 'leaf-group',
    });

    const enteredGroupId = useStore.getState().enteredGroupId;
    expect(enteredGroupId).toBe('leaf-group');

    const chain = [...ancestorsOf(groups, enteredGroupId!).reverse(), enteredGroupId!];
    expect(chain).toEqual(['root-group', 'mid-group', 'leaf-group']);

    const labels = chain.map((id) => groups[id as keyof typeof groups]?.name);
    expect(labels).toEqual(['Layout', 'Cards', 'Card 1']);
  });

  it('handles empty or top-level enteredGroupId cleanly', () => {
    useStore.setState({ enteredGroupId: null });
    expect(useStore.getState().enteredGroupId).toBeNull();

    useStore.getState().setEnteredGroupId('root-group');
    expect(useStore.getState().enteredGroupId).toBe('root-group');

    useStore.getState().setEnteredGroupId(null);
    expect(useStore.getState().enteredGroupId).toBeNull();
  });
});
