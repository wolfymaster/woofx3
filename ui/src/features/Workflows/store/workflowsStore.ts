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
const workflows = workflowsStore.get();

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
    workflowsStore.set([...wf]);
  }
};

export const toggleWorkflowSelection = (title: string) => {
  const selected = selectedWorkflowsStore.get();
  const index = selected.indexOf(title);
  const next = index > -1
    ? [...selected.slice(0, index), ...selected.slice(index + 1)]
    : [...selected, title];
  selectedWorkflowsStore.set(next);
};

export const toggleSelectAll = () => {
  const isAllSelected = allSelected.get();
  if (isAllSelected) {
    selectedWorkflowsStore.set([]);
    allSelected.set(false);
  } else {
    const source = filteredWorkflows.get();
    const names = (source.length ? source : workflowsStore.get()).map(w => w.name);
    selectedWorkflowsStore.set(names);
    allSelected.set(true);
  }
};

export const togglePinned = (name: string) => {
    const wfPin = workflows.find(w => w.name === name);
    if(wfPin){
        wfPin.pinned = !wfPin.pinned;
    }
};

export const toggleDropdown = (title: string) => {
  const current = openDropdownStore.get();
  openDropdownStore.set(current === title ? null : title);
};

export const enableSelected = () => {
  const selected = selectedWorkflowsStore.get();
  selected.forEach(title => {
    updateWorkflowStatus(title, true);
  });
};

export const disableSelected = () => {
  const selected = selectedWorkflowsStore.get();
  selected.forEach(title => {
    updateWorkflowStatus(title, false);
  });
  selectedWorkflowsStore.set([]);
};

export const deleteSelected = () => {
  const count = selectedWorkflowsStore.get().length;
  if (confirm(`Are you sure you want to delete ${count} workflow(s)?`)) {
    const selected = selectedWorkflowsStore.get();
    const current = workflowsStore.get();
    const filtered = current.filter(w => !selected.includes(w.name));
    workflowsStore.set(filtered);
    selectedWorkflowsStore.set([]);
  }
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
