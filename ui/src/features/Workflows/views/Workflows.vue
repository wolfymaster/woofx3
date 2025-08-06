<template>
  <div class="workflows-page">
    <h2 class="workflows-title">Workflows</h2>
    <div class="workflows-header">
             <!-- View Toggle (TODO: add option to default a specific view in settings) -->
       <div class="view-toggle">
         <button 
           @click="viewMode = 'cards'" 
           :class="{ active: viewMode === 'cards' }"
           class="tab-btn">
            Starred
         </button>
         <button 
           @click="viewMode = 'table'" 
           :class="{ active: viewMode === 'table' }"
           class="tab-btn">
            All Workflows
         </button>
       </div>
    </div>

    <!-- Bulk Actions (only visible in table mode) -->
    <div v-if="viewMode === 'table' && selectedWorkflows.length > 0" class="bulk-actions">
      <span>{{ selectedWorkflows.length }} workflow(s) selected</span>
      <button @click="enableSelected" class="bulk-btn enable">Enable Selected</button>
      <button @click="disableSelected" class="bulk-btn disable">Disable Selected</button>
      <button @click="deleteSelected" class="bulk-btn delete">Delete Selected</button>
    </div>

    <!-- Card View -->
    <div v-if="viewMode === 'cards'" class="workflows-grid">
      <wfCard
        v-for="workflow in processedWorkflows"
        :key="workflow.title"
        type="module"
        :title="workflow.title"
        :description="workflow.description"
        :tags="workflow.tags"
        :enabled="workflow.enabled"
        :show-config="true"
        @update:enabled="updateWorkflowStatus(workflow.title, $event)"
      />
    </div>

    <!-- Table View -->
    <div v-if="viewMode === 'table'" class="table-container">
      <table class="workflows-table">
        <thead>
          <tr>
            <th class="checkbox-column">
              <input 
                type="checkbox" 
                :checked="allSelected"
                @change="toggleSelectAll"
                class="select-all-checkbox"
              />
            </th>
                         <th>Workflow Name</th>
             <th>Description</th>
             <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="workflow in processedWorkflows" :key="workflow.title" class="workflow-row">
            <td class="checkbox-column">
              <input 
                type="checkbox" 
                :checked="selectedWorkflows.includes(workflow.title)"
                @change="toggleWorkflowSelection(workflow.title)"
                class="workflow-checkbox"
              />
            </td>
            <td class="workflow-name">
              <div class="name-cell">
                <span>{{ workflow.title }}</span>
              </div>
            </td>
            <td class="workflow-description">{{ workflow.description }}</td>
                         <td class="workflow-status">
               <div class="status-cell">
                 <button 
                   @click="updateWorkflowStatus(workflow.title, !workflow.enabled)"
                   :class="['status-badge', 'clickable', workflow.enabled ? 'enabled' : 'disabled']"
                 >
                   {{ workflow.enabled ? 'Active' : 'Inactive' }}
                 </button>
                 <div class="action-dropdown">
                   <button @click="toggleDropdown(workflow.title)" class="dropdown-btn">
                     ⋯
                   </button>
                   <div v-if="openDropdown === workflow.title" class="dropdown-menu">
                     <button @click="configureWorkflow(workflow.title)" class="dropdown-item">
                       Configure
                     </button>
                     <button @click="configureWorkflow(workflow.title)" class="dropdown-item">
                       Star
                     </button>
                     <button @click="configureWorkflow(workflow.title)" class="dropdown-item">
                       Archive
                     </button>
                   </div>
                 </div>
               </div>
             </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import wfCard from '@/components/Card/Card.vue';

//TODO: move logic to store
// View mode state
const viewMode = ref<'cards' | 'table'>('cards');

// Workflow data with status
const rawWorkflows = [
  {
    name: 'Follow Alert Workflow',
    description: 'Automated workflow that triggers custom alerts, chat messages, and overlay animations when someone follows your channel.',
    tags: ['Alerts', 'Automation', 'Engagement'],
    logo: 'https://placehold.co/40x40?text=FA',
    enabled: true
  },
  {
    name: 'Subscriber Welcome Flow',
    description: 'Multi-step workflow for new subscribers including welcome messages, special role assignment, and exclusive content access.',
    tags: ['Subscribers', 'Welcome', 'Roles'],
    logo: 'https://placehold.co/40x40?text=SW',
    enabled: false
  },
  {
    name: 'Donation Celebration',
    description: 'Dynamic workflow that scales celebrations based on donation amount, from simple thank yous to elaborate animations.',
    tags: ['Donations', 'Celebration', 'Dynamic'],
    logo: 'https://placehold.co/40x40?text=DC',
    enabled: true
  },
  {
    name: 'Raid Response System',
    description: 'Automated raid handling with welcome messages, follower goals, and special raid-only commands for incoming viewers.',
    tags: ['Raids', 'Welcome', 'Goals'],
    logo: 'https://placehold.co/40x40?text=RR',
    enabled: false
  }
];

// Converting to structure for wfCard.vue
const processedWorkflows = ref(rawWorkflows.map((w) => ({
  title: w.name,
  description: w.description,
  tags: w.tags.map((tag: string) => ({ title: tag })),
  logo: w.logo || 'https://placehold.co/40x40?text=MC',
  enabled: w.enabled
})));

// Selection state
const selectedWorkflows = ref<string[]>([]);

// Dropdown state
const openDropdown = ref<string | null>(null);

// Computed properties
const allSelected = computed(() => {
  return processedWorkflows.value.length > 0 && 
         selectedWorkflows.value.length === processedWorkflows.value.length;
});

// Methods
const updateWorkflowStatus = (title: string, enabled: boolean) => {
  const workflow = processedWorkflows.value.find(w => w.title === title);
  if (workflow) {
    workflow.enabled = enabled;
  }
};

const toggleWorkflowSelection = (title: string) => {
  const index = selectedWorkflows.value.indexOf(title);
  if (index > -1) {
    selectedWorkflows.value.splice(index, 1);
  } else {
    selectedWorkflows.value.push(title);
  }
};

const toggleSelectAll = () => {
  if (allSelected.value) {
    selectedWorkflows.value = [];
  } else {
    selectedWorkflows.value = processedWorkflows.value.map(w => w.title);
  }
};

const configureWorkflow = (title: string) => {
  console.log(`Configuring workflow: ${title}`);
  // Add your configuration logic here
  openDropdown.value = null;
};

const toggleDropdown = (title: string) => {
  if (openDropdown.value === title) {
    openDropdown.value = null;
  } else {
    openDropdown.value = title;
  }
};

const enableSelected = () => {
  selectedWorkflows.value.forEach(title => {
    updateWorkflowStatus(title, true);
  });
  selectedWorkflows.value = [];
};

const disableSelected = () => {
  selectedWorkflows.value.forEach(title => {
    updateWorkflowStatus(title, false);
  });
  selectedWorkflows.value = [];
};

const deleteSelected = () => {
  if (confirm(`Are you sure you want to delete ${selectedWorkflows.value.length} workflow(s)?`)) {
    processedWorkflows.value = processedWorkflows.value.filter(
      w => !selectedWorkflows.value.includes(w.title)
    );
    selectedWorkflows.value = [];
  }
};
</script>

<style scoped>
.workflows-page {
  padding: 2rem;
  color: var(--color-text);
}

.workflows-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.workflows-title {
  font-size: 3rem;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
  color: var(--color-primary);
  margin: 0;
  text-align: center;
}

.view-toggle {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 1rem;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
  position: relative;
}

.tab-btn:hover {
  color: var(--color-primary);
  background: rgba(147, 51, 234, 0.05);
}

.tab-btn.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  background: transparent;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-primary);
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--color-card-background);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.bulk-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.bulk-btn.enable {
  background: #10b981;
  color: white;
}

.bulk-btn.disable {
  background: #f59e0b;
  color: white;
}

.bulk-btn.delete {
  background: #ef4444;
  color: white;
}

.workflows-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.table-container {
  background: var(--color-card-background);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
}

.workflows-table {
  width: 100%;
  border-collapse: collapse;
}

.workflows-table th,
.workflows-table td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

.workflows-table th {
  background: var(--color-primary);
  color: white;
  font-weight: 600;
}

.checkbox-column {
  width: 50px;
  text-align: center;
}

.workflow-row:hover {
  background: rgba(147, 51, 234, 0.05);
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.workflow-logo {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
}

.workflow-description {
  max-width: 300px;
  color: var(--color-body-text);
}

.status-badge {
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
}

.status-badge.enabled {
  background: #dcfce7;
  color: #166534;
}

.status-badge.disabled {
  background: #fef3c7;
  color: #92400e;
}

.status-badge.clickable {
  cursor: pointer;
  border: none;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  font-family: inherit;
}

.status-badge.clickable:hover {
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.status-badge.clickable:active {
  transform: scale(0.95);
}

.status-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.action-dropdown {
  position: relative;
}

.dropdown-btn {
  background: transparent;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  color: var(--color-text);
  transition: all 0.2s ease;
}

.dropdown-btn:hover {
  background: rgba(147, 51, 234, 0.1);
  color: var(--color-primary);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
  min-width: 120px;
  margin-top: 0.25rem;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text);
  transition: background 0.2s ease;
}

.dropdown-item:hover {
  background: rgba(147, 51, 234, 0.1);
  color: var(--color-primary);
}

.configure-btn,
.action-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.configure-btn {
  background: var(--color-primary);
  color: white;
}

.action-btn.enable {
  background: #10b981;
  color: white;
}

.action-btn.disable {
  background: #f59e0b;
  color: white;
}

.select-all-checkbox,
.workflow-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .workflows-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }
  
  .workflows-table {
    font-size: 0.875rem;
  }
  
  .workflow-description {
    max-width: 200px;
  }
}
</style>