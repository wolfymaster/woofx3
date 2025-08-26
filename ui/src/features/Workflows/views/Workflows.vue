<template>
  <div class="workflows-page">
    <h2 class="workflows-title">Workflows</h2>
    <div class="workflows-header">
             <!-- View Toggle (TODO: add option to default a specific view in settings) -->
               <div class="view-toggle">
          <button 
            @click="viewModeStore.set('cards')" 
            :class="{ active: viewMode === 'cards' }"
            class="tab-btn">
             Pinned
          </button>
          <button 
            @click="viewModeStore.set('table')" 
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
         v-for="workflow in filteredWorkflowsList"
         :key="workflow.name"
         type="module"
         :title="workflow.name"
         :description="workflow.description"
         :tags="[...workflow.tags]"
         :enabled="workflow.enabled"
         :pinned="workflow.pinned"
         :show-config="true"
         @update:enabled="updateWorkflowStatus(workflow.name, $event)"
       />
     </div>

         <!-- Table View -->
     <div v-if="viewMode === 'table'" class="table-container">
       <!-- Search and Filter Bar -->
       <div class="search-filter-bar">
         <div class="search-section">
                       <input 
              :value="searchQuery"
              @input="(event) => searchQueryStore.set((event.target as HTMLInputElement).value)"
              type="text" 
              placeholder="Search workflows..."
              class="search-input"/>
         </div>
         <div class="filter-section">
                       <select :value="statusFilter" @change="(event) => statusFilterStore.set((event.target as HTMLSelectElement).value)" class="filter-select">
              <option value="">All Status</option>
              <option value="enabled">Active</option>
              <option value="disabled">Inactive</option>
            </select>
                        <select :value="tagFilter" @change="(event) => tagFilterStore.set((event.target as HTMLSelectElement).value)" class="filter-select">
               <option value="">All Tags</option>
               <option v-for="tag in availableTagsList" :key="String(tag)" :value="tag">
                 {{ tag }}
               </option>
             </select>
         </div>
       </div>
       
               <table class="workflows-table">
         <thead>
           <tr>
                           <th class="checkbox-column">
                <input 
                  type="checkbox" 
                  :checked="allSelectedState"
                  @change="toggleSelectAll"
                  class="select-all-checkbox"/>
              </th>
             <th>Workflow Name</th>
             <th>Description</th>
             <th>Status</th>
           </tr>
         </thead>
                     <tbody>
                       <tr v-for="workflow in filteredWorkflowsList" :key="workflow.name" class="workflow-row">
             <td class="checkbox-column">
               <input 
                 type="checkbox" 
                 :checked="selectedWorkflows.includes(workflow.name)"
                 @change="toggleWorkflowSelection(workflow.name)"
                 class="workflow-checkbox"
               />
             </td>
             <td class="workflow-name">
               <div class="name-cell">
                 <span>{{ workflow.name }}</span>
               </div>
             </td>
             <td class="workflow-description">{{ workflow.description }}</td>
                          <td class="workflow-status">
                <div class="status-cell">
                  <button 
                    @click="updateWorkflowStatus(workflow.name, !workflow.enabled)"
                    :class="['status-badge', 'clickable', workflow.enabled ? 'enabled' : 'disabled']"
                  >
                    {{ workflow.enabled ? 'Active' : 'Inactive' }}
                  </button>
                  <div class="action-dropdown">
                    <button @click="toggleDropdown(workflow.name)" class="dropdown-btn">
                      ⋯
                    </button>
                    <div v-if="openDropdown === workflow.name" class="dropdown-menu">
                      <button @click="configureWorkflow(workflow.name)" class="dropdown-item">
                        Configure
                      </button>
                      <button @click="togglePinned(workflow.name)" class="dropdown-item">
                        <span :class="['paw-icon', workflow.pinned ? 'pinned' : 'unpinned']">
                          {{ workflow.pinned ? '🐾' : '🐾' }}
                        </span>
                        {{ workflow.pinned ? 'Unpin' : 'Pin' }}
                      </button>
                      <button @click="configureWorkflow(workflow.name)" class="dropdown-item">
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
import { useStore } from '@nanostores/vue';
import wfCard from '../../../components/Card/Card.vue';
import {
  workflowsStore,
  selectedWorkflowsStore,
  searchQueryStore,
  statusFilterStore,
  tagFilterStore,
  viewModeStore,
  openDropdownStore,
  availableTags,
  filteredWorkflows,
  allSelected,
  updateWorkflowStatus,
  enableSelected,
  disableSelected,
  deleteSelected,
  toggleWorkflowSelection,
  toggleSelectAll,
  toggleDropdown,
  togglePinned
} from '../store/workflowsStore';

//TODO: move logic to store
//TODO: update workflow views to show and hide cards on pinned 

//atoms to vue Refs
const viewMode = useStore(viewModeStore);
const workflows = useStore(workflowsStore);
const selectedWorkflows = useStore(selectedWorkflowsStore);
const searchQuery = useStore(searchQueryStore);
const statusFilter = useStore(statusFilterStore);
const tagFilter = useStore(tagFilterStore);
const openDropdown = useStore(openDropdownStore);
const filteredWorkflowsList = useStore(filteredWorkflows);
const allSelectedState = useStore(allSelected);
const availableTagsList = useStore(availableTags);

// Methods

const configureWorkflow = (name: string) => {
  console.log(`Configuring workflow: ${name}`);
  // Add your configuration logic here
  openDropdownStore.set(null);
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
  width: 100%;
  border-radius: 12px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
}

.search-filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
  gap: 1rem;
}

.search-section {
  position: relative;
  flex: 1;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: 0.5rem 2.5rem 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.875rem;
  background: white;
  transition: border-color 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.1);
}

.search-icon {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text);
  font-size: 0.875rem;
  pointer-events: none;
}

.filter-section {
  display: flex;
  gap: 0.5rem;
}

.filter-select {
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.875rem;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.filter-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.1);
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
  width: 5%;
  text-align: center;
}

.workflow-description {
  max-width: 30%;
  color: var(--color-body-text);
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

.paw-icon {
  margin-right: 0.5rem;
  font-size: 1rem;
  transition: all 0.2s ease;
}

.paw-icon.unpinned {
  opacity: 0.6;
  filter: grayscale(1);
}

.paw-icon.pinned {
  opacity: 1;
  filter: none;
  transform: scale(1.1);
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

/* Responsive Design */
@media (max-width: 1024px) {
  .workflows-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }
  
  .search-filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
  
  .filter-section {
    justify-content: space-between;
  }
}

@media (max-width: 768px) {
  .workflows-page {
    padding: 1rem;
  }
  
  .workflows-title {
    font-size: 2rem;
  }
  
  .workflows-header {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }
  
  .view-toggle {
    justify-content: center;
  }
  
  .bulk-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
  
  .bulk-actions span {
    text-align: center;
  }
  
  .workflows-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .search-filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
  
  .search-section {
    max-width: none;
  }
  
  .filter-section {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  /* Table Responsive Styles */
  .table-container {
    border-radius: 8px;
  }
  
  .workflows-table {
    font-size: 0.875rem;
  }
  
  .workflows-table th,
  .workflows-table td {
    padding: 0.75rem 0.5rem;
  }
  
  .status-cell {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  
  .dropdown-menu {
    right: -50px;
    min-width: 140px;
  }
}

@media (max-width: 480px) {
  .workflows-page {
    padding: 0.5rem;
  }
  
  .workflows-title {
    font-size: 1.5rem;
  }
  
  .tab-btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
  }
  
  .bulk-actions {
    padding: 0.75rem;
  }
  
  .bulk-btn {
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
  }
  
  .search-input {
    padding: 0.4rem 1rem;
    font-size: 0.8rem;
  }
  
  .filter-select {
    padding: 0.4rem;
    font-size: 0.8rem;
  }
  
  /* Table Responsive for Mobile */
  .table-container {
    margin: 0 -0.5rem; /* Negative margin to extend to edges */
    border-radius: 0;
  }
  
  .workflows-table {
    font-size: 0.75rem;
  }
  
  .workflows-table th,
  .workflows-table td {
    padding: 0.5rem 0.25rem;
  }
  
  .status-badge {
    padding: 0.2rem 0.5rem;
    font-size: 0.7rem;
  }
  
  .dropdown-btn {
    font-size: 0.9rem;
    padding: 0.2rem;
  }
  
  .dropdown-item {
    padding: 0.4rem 0.5rem;
    font-size: 0.75rem;
  }
  
  .checkbox-column {
    width: 30px;
  }
  
  .select-all-checkbox,
  .workflow-checkbox {
    width: 16px;
    height: 16px;
  }
}
</style>