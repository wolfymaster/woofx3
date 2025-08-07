import { atom } from 'nanostores';

export interface WorkflowTag {
    title: string
}

export interface Workflow {
  name: string;
  description: string;
  tags: WorkflowTag[];
  logo: string;
  enabled: boolean;
  pinned: boolean;
}

const rawWorkflows = [
    {
      name: 'Follow Alert Workflow',
      description: 'Automated workflow that triggers custom alerts, chat messages, and overlay animations when someone follows your channel.',
      tags: [{ title: 'Alerts' }, { title: 'Automation' }, { title: 'Engagement' }],
      logo: 'https://placehold.co/40x40?text=FA',
      enabled: true,
      pinned: true
    },
    {
      name: 'Subscriber Welcome Flow',
      description: 'Multi-step workflow for new subscribers including welcome messages, special role assignment, and exclusive content access.',
      tags: [{ title: 'Subscribers' }, { title: 'Welcome' }, { title: 'Roles' }],
      logo: 'https://placehold.co/40x40?text=SW',
      enabled: false,
      pinned: true
    },
    {
      name: 'Donation Celebration',
      description: 'Dynamic workflow that scales celebrations based on donation amount, from simple thank yous to elaborate animations.',
      tags: [{ title: 'Donations' }, { title: 'Celebration' }, { title: 'Dynamic' }],
      logo: 'https://placehold.co/40x40?text=DC',
      enabled: true,
      pinned: true
    },
    {
      name: 'Raid Response System',
      description: 'Automated raid handling with welcome messages, follower goals, and special raid-only commands for incoming viewers.',
      tags: [{ title: 'Raids' }, { title: 'Welcome' }, { title: 'Goals' }],
      logo: 'https://placehold.co/40x40?text=RR',
      enabled: false,
      pinned: true
    }
  ];

// Store state
export const workflowsStore = atom<Workflow[]>([]);
export const selectedWorkflowsStore = atom<string[]>([]);
export const searchQueryStore = atom<string>('');
export const statusFilterStore = atom<string>('');
export const tagFilterStore = atom<string>('');
export const viewModeStore = atom<'cards' | 'table'>('cards');
export const openDropdownStore = atom<string | null>(null);

// Computed properties
export const filteredWorkflows = atom<Workflow[]>([]);
export const allSelected = atom<boolean>(false);
export const availableTags = atom<string[]>([]);

// Actions
workflowsStore.set(rawWorkflows); //only temporary until api call is implemented

export const processWorkflows = () => {
const raw = workflowsStore.get();
const processed = raw.map(w => ({
    name: w.name,
    description: w.description,
    tags: w.tags,
    logo: w.logo || 'https://placehold.co/40x40?text=MC',
    enabled: w.enabled,
    pinned: w.pinned
}));
    workflowsStore.set(processed);
}

export const updateWorkflowStatus = (name: string, enabled: boolean) => {
  const wf = workflowsStore.get();
  const found = wf.find(w => w.name === name);
  if(found){
    found.enabled = enabled;
  }
};

export const toggleWorkflowSelection = (title: string) => {
  // TODO: Implement individual workflow selection toggle
};

export const toggleSelectAll = () => {
  // TODO: Implement select all/deselect all
};

export const togglePinned = (title: string) => {
  // TODO: Implement pin/unpin workflow
};

export const toggleDropdown = (title: string) => {
  // TODO: Implement dropdown toggle
};

export const enableSelected = () => {
  // TODO: Implement bulk enable
};

export const disableSelected = () => {
  // TODO: Implement bulk disable
};

export const deleteSelected = () => {
  // TODO: Implement bulk delete
};

export const addWorkflow = (workflow: Workflow) => {
  // TODO: Implement workflow creation
};

// Computed property updates (will be implemented)
export const updateFilteredWorkflows = () => {
  // TODO: Implement filtering logic
};

export const updateAllSelected = () => {
  // TODO: Implement all selected computation
};

export const updateAvailableTags = () => {
  // TODO: Implement available tags computation
};
