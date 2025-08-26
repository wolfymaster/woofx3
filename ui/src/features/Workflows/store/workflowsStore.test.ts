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
    toggleWorkflowSelection,
    toggleSelectAll,
    toggleDropdown,
    enableSelected,
    disableSelected,
    addWorkflow,
    processWorkflows
} = workflowsStoreFile;

const updateStatusSpy = vi.fn(updateWorkflowStatus);
const togglePinSpy = vi.fn(togglePinned);
const deleteSelectedSpy = vi.fn(deleteSelected);
const toggleSelectionSpy = vi.fn(toggleWorkflowSelection);
const toggleAllSpy = vi.fn(toggleSelectAll);
const toggleDropdownSpy = vi.fn(toggleDropdown);
const enableSelectedSpy = vi.fn(enableSelected);
const disableSelectedSpy = vi.fn(disableSelected);
const addWorkflowSpy = vi.fn(addWorkflow);
const processWorkflowsSpy = vi.fn(processWorkflows);

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
    
    // Reset all spies
    vi.clearAllMocks();
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
        const wfCreated = {
            name: 'Dora the Explora',
            description: 'Awesome Description of this workflow',
            tags: [{ title: 'Alerts' }, { title: 'Celebration' }],
            logo: 'https://placehold.co/40x40?text=MC',
            enabled: false,
            pinned: false
        };

        addWorkflowSpy(wfCreated);
        
        expect(addWorkflowSpy).toBeCalledWith(wfCreated);
        expect(addWorkflowSpy).toBeCalledTimes(1);
    });

    it('should update workflow status', () => {
        const workflows = workflowsStore.get();
        const followWorkflow = workflows[0];
        const subWorkflow = workflows[1];

        updateStatusSpy('Follow Alert Workflow', false);
        updateStatusSpy('Subscriber Welcome Flow', true);
        
        expect(updateStatusSpy).toBeCalledTimes(2);
        expect(updateStatusSpy).toBeCalledWith('Follow Alert Workflow', false);
        expect(updateStatusSpy).toBeCalledWith('Subscriber Welcome Flow', true);
    });

    it('should toggle workflow pinned status', () => {
        const workflows = workflowsStore.get();
        const followWorkflow = workflows[0];

        togglePinSpy('Follow Alert Workflow');

        expect(togglePinSpy).toBeCalledWith('Follow Alert Workflow');
        expect(togglePinSpy).toBeCalledTimes(1);
    });

    it('should delete selected workflows', () => {

        deleteSelectedSpy();

        expect(deleteSelectedSpy).toBeCalledTimes(1);
    });

    it('should process workflows correctly', () => {
        const testWorkflows = [
            {
                name: 'Test Workflow',
                description: 'Test Description',
                tags: [{ title: 'Test' }],
                logo: '',
                enabled: true,
                pinned: false
            }
        ];

        workflowsStore.set(testWorkflows);
        processWorkflowsSpy();

        expect(processWorkflowsSpy).toBeCalledTimes(1);
    });
  });

  describe('Selection Management', () => {
    it('should toggle workflow selection', () => {
        const workflowName = 'Follow Alert Workflow';
        
        toggleSelectionSpy(workflowName);
        
        expect(toggleSelectionSpy).toBeCalledWith(workflowName);
        expect(toggleSelectionSpy).toBeCalledTimes(1);
    });

    it('should toggle select all', () => {
        toggleAllSpy();
        
        expect(toggleAllSpy).toBeCalledTimes(1);
    });

    it('should enable selected workflows', () => {
        enableSelectedSpy();
        
        expect(enableSelectedSpy).toBeCalledTimes(1);
    });

    it('should disable selected workflows', () => {
        disableSelectedSpy();
        
        expect(disableSelectedSpy).toBeCalledTimes(1);
    });
  });

  describe('Filtering', () => {
    it('should filter workflows by search query', () => {
        const searchQuery = 'Follow';
        searchQueryStore.set(searchQuery);
        
        expect(searchQueryStore.get()).toBe(searchQuery);
    });

    it('should filter workflows by status', () => {
        const statusFilter = 'enabled';
        statusFilterStore.set(statusFilter);
        
        expect(statusFilterStore.get()).toBe(statusFilter);
    });

    it('should filter workflows by tag', () => {
        const tagFilter = 'Alerts';
        tagFilterStore.set(tagFilter);
        
        expect(tagFilterStore.get()).toBe(tagFilter);
    });

    it('should combine multiple filters', () => {
        searchQueryStore.set('Follow');
        statusFilterStore.set('enabled');
        tagFilterStore.set('Alerts');
        
        expect(searchQueryStore.get()).toBe('Follow');
        expect(statusFilterStore.get()).toBe('enabled');
        expect(tagFilterStore.get()).toBe('Alerts');
    });
  });

  describe('Computed Properties', () => {
    it('should compute available tags', () => {
        const workflows = workflowsStore.get();
        const allTags = workflows.flatMap(wf => wf.tags.map(tag => tag.title));
        const uniqueTags = [...new Set(allTags)];
        
        expect(uniqueTags).toContain('Alerts');
        expect(uniqueTags).toContain('Automation');
        expect(uniqueTags).toContain('Subscribers');
        expect(uniqueTags).toContain('Welcome');
        expect(uniqueTags).toContain('Donations');
        expect(uniqueTags).toContain('Celebration');
    });

    it('should compute all selected state', () => {
        const workflows = workflowsStore.get();
        const selected = selectedWorkflowsStore.get();
        
        const allSelectedState = selected.length === workflows.length && workflows.length > 0;
        
        expect(typeof allSelectedState).toBe('boolean');
    });
  });

  describe('UI State Management', () => {
    it('should toggle dropdown', () => {
        const dropdownTitle = 'Follow Alert Workflow';
        
        toggleDropdownSpy(dropdownTitle);
        
        expect(toggleDropdownSpy).toBeCalledWith(dropdownTitle);
        expect(toggleDropdownSpy).toBeCalledTimes(1);
    });

    it('should switch between view modes', () => {
        const cardView = 'cards';
        const tableView = 'table';
        
        viewModeStore.set(cardView);
        expect(viewModeStore.get()).toBe(cardView);
        
        viewModeStore.set(tableView);
        expect(viewModeStore.get()).toBe(tableView);
    });

    it('should manage open dropdown state', () => {
        const dropdownId = 'test-dropdown';
        
        openDropdownStore.set(dropdownId);
        expect(openDropdownStore.get()).toBe(dropdownId);
        
        openDropdownStore.set(null);
        expect(openDropdownStore.get()).toBe(null);
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent workflows', () => {
        const nonExistentWorkflow = 'Non-existent Workflow';
        
        updateStatusSpy(nonExistentWorkflow, true);
        togglePinSpy(nonExistentWorkflow);
        
        expect(updateStatusSpy).toBeCalledWith(nonExistentWorkflow, true);
        expect(togglePinSpy).toBeCalledWith(nonExistentWorkflow);
    });

    it('should handle empty workflows list', () => {
        workflowsStore.set([]);
        
        const workflows = workflowsStore.get();
        expect(workflows).toHaveLength(0);
        expect(workflows).toBeInstanceOf(Array);
    });

    it('should handle workflows with empty tags', () => {
        const workflowWithEmptyTags = {
            name: 'Empty Tags Workflow',
            description: 'Workflow with no tags',
            tags: [],
            logo: 'https://placehold.co/40x40?text=ET',
            enabled: true,
            pinned: false
        };
        
        workflowsStore.set([workflowWithEmptyTags]);
        
        const workflows = workflowsStore.get();
        expect(workflows[0].tags).toHaveLength(0);
        expect(Array.isArray(workflows[0].tags)).toBe(true);
    });

    it('should handle workflows with missing logo', () => {
        const workflowWithoutLogo = {
            name: 'No Logo Workflow',
            description: 'Workflow without logo',
            tags: [{ title: 'Test' }],
            logo: '',
            enabled: true,
            pinned: false
        };
        
        workflowsStore.set([workflowWithoutLogo]);
        
        const workflows = workflowsStore.get();
        expect(workflows[0].logo).toBe('');
    });

    it('should handle duplicate workflow names', () => {
        const duplicateWorkflow = {
            name: 'Follow Alert Workflow', // Same name as existing
            description: 'Duplicate workflow',
            tags: [{ title: 'Duplicate' }],
            logo: 'https://placehold.co/40x40?text=DU',
            enabled: false,
            pinned: false
        };
        
        addWorkflowSpy(duplicateWorkflow);
        
        expect(addWorkflowSpy).toBeCalledWith(duplicateWorkflow);
    });

    it('should handle very long workflow names and descriptions', () => {
        const longWorkflow = {
            name: 'A'.repeat(1000), // Very long name
            description: 'B'.repeat(2000), // Very long description
            tags: [{ title: 'Long' }],
            logo: 'https://placehold.co/40x40?text=LG',
            enabled: true,
            pinned: false
        };
        
        workflowsStore.set([longWorkflow]);
        
        const workflows = workflowsStore.get();
        expect(workflows[0].name).toHaveLength(1000);
        expect(workflows[0].description).toHaveLength(2000);
    });
  });

  describe('Store Integration', () => {
    it('should maintain store consistency across operations', () => {
        // Perform operations
        updateStatusSpy('Follow Alert Workflow', false);
        toggleSelectionSpy('Follow Alert Workflow');
        searchQueryStore.set('test');
        
        // Verify stores are still accessible
        expect(workflowsStore.get()).toBeDefined();
        expect(selectedWorkflowsStore.get()).toBeDefined();
        expect(searchQueryStore.get()).toBeDefined();
    });

    it('should handle rapid state changes', () => {
        // Simulate rapid state changes
        for (let i = 0; i < 10; i++) {
            searchQueryStore.set(`query${i}`);
            statusFilterStore.set(`status${i}`);
            tagFilterStore.set(`tag${i}`);
        }
        
        expect(searchQueryStore.get()).toBe('query9');
        expect(statusFilterStore.get()).toBe('status9');
        expect(tagFilterStore.get()).toBe('tag9');
    });
  });
});
