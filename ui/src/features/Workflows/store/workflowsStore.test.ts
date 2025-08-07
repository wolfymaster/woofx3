import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as workflowsStoreFile from './workflowsStore';

const {
    workflowsStore, 
    selectedWorkflowsStore, 
    searchQueryStore, 
    statusFilterStore, 
    tagFilterStore, 
    viewModeStore, 
    openDropdownStore,
    updateWorkflowStatus,
    togglePinned,
    deleteSelected,
    allSelected
} = workflowsStoreFile;

const updateStatusSpy = vi.fn(updateWorkflowStatus);
const togglePinSpy = vi.fn(togglePinned);
const deleteSelectedSpy = vi.fn(deleteSelected);

describe('WorkflowsStore', () => {
  beforeEach(() => {
    workflowsStore.set([
        {
            name: 'Follow Alert Workflow',
            description: 'Automated workflow that triggers custom alerts...',
            tags: [{ title: 'Alerts' }, { title: 'Automation' }],
            logo: 'https://placehold.co/40x40?text=FA',
            enabled: true,
            pinned: false
          },
          {
            name: 'Subscriber Welcome Flow', 
            description: 'Multi-step workflow for new subscribers...',
            tags: [{ title: 'Subscribers' }, { title: 'Welcome' }],
            logo: 'https://placehold.co/40x40?text=SW',
            enabled: false,
            pinned: false
          },
          {
            name: 'Donation Celebration',
            description: 'Dynamic workflow that scales celebrations...',
            tags: [{ title: 'Donations' }, { title: 'Celebration' }],
            logo: 'https://placehold.co/40x40?text=DC', 
            enabled: true,
            pinned: false
          }
    ]);
    selectedWorkflowsStore.set([]);
    searchQueryStore.set('');
    statusFilterStore.set('');
    tagFilterStore.set('');
    viewModeStore.set('cards');
    openDropdownStore.set(null);
  });

  describe('Workflow Management', () => {
    it('should initialize with default workflows', () => {
      const workflows = workflowsStore.get();

      expect(workflows).toHaveLength(3);
      expect(workflows).toBeInstanceOf(Array);

      workflows.forEach(wf => {
        expect(wf.name).toBeTruthy();
        expect(wf.description).toBeTruthy();
        expect(Array.isArray(wf.tags)).toBe(true);
      })

    });

    it('should add newly created workflow to all workflows', () => {
        // TODO: Test workflow creation success
        const wfCreated = {
            name: 'Dora the Explora',
            description: 'Awesome Description of this workflow',
            tags: [{ title: 'Alerts' }, { title: 'Celebration' }],
            logo: 'https://placehold.co/40x40?text=MC',
            enabled: false,
            pinned: false
        }


      });

    it('should update workflow status', () => {
        const updatedFollow = workflowsStore.get()[0]
        const updatedSub = workflowsStore.get()[1]

        updateStatusSpy('Follow Alert Workflow', false)
        updateStatusSpy('Subscriber Welcome Flow', true)
        
        expect(updateStatusSpy).toBeCalledTimes(2);
        expect(updatedFollow.enabled).toBe(false);
        expect(updatedSub.enabled).toBe(true);
    });

    it('should toggle workflow pinned status', () => {
        const workflows = workflowsStore.get();
        const follow = workflows[0];
        const disabledWorkflows = workflows.filter(wf => wf.enabled === false);

        togglePinSpy('Follow Alert Workflow');

        expect(follow.enabled).toBe(false);
        expect(disabledWorkflows).toHaveLength(2);

    });

    it('should delete selected workflows', () => {
        const selected = selectedWorkflowsStore.get();

        deleteSelectedSpy();

        expect(selected).toHaveLength(0);
        expect(allSelected).toBe(false);

    });
  });

  describe('Selection Management', () => {
    it('should toggle workflow selection', () => {
      // TODO: Test individual selection
    });

    it('should toggle select all', () => {
      // TODO: Test select all/deselect all
    });

    it('should enable selected workflows', () => {
      // TODO: Test bulk enable
    });

    it('should disable selected workflows', () => {
      // TODO: Test bulk disable
    });
  });

  describe('Filtering', () => {
    it('should filter workflows by search query', () => {
      // TODO: Test search functionality
    });

    it('should filter workflows by status', () => {
      // TODO: Test status filtering
    });

    it('should filter workflows by tag', () => {
      // TODO: Test tag filtering
    });

    it('should combine multiple filters', () => {
      // TODO: Test combined filters
    });
  });

  describe('Computed Properties', () => {
    it('should compute available tags', () => {
      // TODO: Test tag computation
    });

    it('should compute all selected state', () => {
      // TODO: Test selection state computation
    });
  });

  describe('UI State Management', () => {
    it('should toggle dropdown', () => {
      // TODO: Test dropdown state
    });

    it('should switch between view modes', () => {
      // TODO: Test view mode switching
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent workflows', () => {
      // TODO: Test error handling
    });

    it('should handle empty workflows list', () => {
      // TODO: Test empty state
    });

    it('should handle workflows with empty tags', () => {
      // TODO: Test edge case with empty tags
    });
  });
});
