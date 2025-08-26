<template>
  <div class="workflow-config-page">
    <div class="config-header">
      <button @click="goBack" class="back-btn">← Back to Workflows</button>
      <h1 class="config-title">Configure Workflow: {{ workflowName }}</h1>
    </div>
    
    <div class="config-content">
      <div class="config-section">
        <h2>Workflow Settings</h2>
        <div class="setting-group">
          <label>Name:</label>
          <input v-model="workflowName" type="text" class="config-input" />
        </div>
        <div class="setting-group">
          <label>Description:</label>
          <textarea v-model="workflowDescription" class="config-textarea" rows="3"></textarea>
        </div>
        <div class="setting-group">
          <label>Status:</label>
          <select v-model="workflowEnabled" class="config-select">
            <option :value="true">Active</option>
            <option :value="false">Inactive</option>
          </select>
        </div>
      </div>
      
      <div class="config-section">
        <h2>Tags</h2>
        <div class="tags-container">
          <div v-for="tag in workflowTags" :key="tag.title" class="tag-item">
            <span>{{ tag.title }}</span>
            <button @click="removeTag(tag)" class="remove-tag">×</button>
          </div>
          <input 
            v-model="newTag" 
            @keyup.enter="addTag"
            placeholder="Add new tag..." 
            class="add-tag-input"
          />
        </div>
      </div>
      
      <div class="config-actions">
        <button @click="saveConfiguration" class="save-btn">Save Changes</button>
        <button @click="goBack" class="cancel-btn">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { workflowsStore, updateWorkflowStatus, togglePinned } from '../store/workflowsStore';

const route = useRoute();
const router = useRouter();

// Workflow data
const workflowName = ref('');
const workflowDescription = ref('');
const workflowEnabled = ref(true);
const workflowTags = ref<Array<{ title: string }>>([]);
const newTag = ref('');

// Load workflow data
onMounted(() => {
  const workflowId = route.params.id as string;
  const workflows = workflowsStore.get();
  const workflow = workflows.find(w => w.name === workflowId);
  
  if (workflow) {
    workflowName.value = workflow.name;
    workflowDescription.value = workflow.description;
    workflowEnabled.value = workflow.enabled;
    workflowTags.value = [...workflow.tags];
  } else {
    // Workflow not found, redirect back
    goBack();
  }
});

// Methods
const goBack = () => {
  router.push('/workflows');
};

const addTag = () => {
  if (newTag.value.trim() && !workflowTags.value.find(t => t.title === newTag.value.trim())) {
    workflowTags.value.push({ title: newTag.value.trim() });
    newTag.value = '';
  }
};

const removeTag = (tag: { title: string }) => {
  const index = workflowTags.value.findIndex(t => t.title === tag.title);
  if (index > -1) {
    workflowTags.value.splice(index, 1);
  }
};

const saveConfiguration = () => {
  const workflowId = route.params.id as string;
  const workflows = workflowsStore.get();
  const workflowIndex = workflows.findIndex(w => w.name === workflowId);
  
  if (workflowIndex > -1) {
    // Update the workflow
    workflows[workflowIndex] = {
      ...workflows[workflowIndex],
      name: workflowName.value,
      description: workflowDescription.value,
      enabled: workflowEnabled.value,
      tags: workflowTags.value
    };
    
    workflowsStore.set([...workflows]);
    goBack();
  }
};
</script>

<style scoped>
.workflow-config-page {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

.config-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

.back-btn {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.config-title {
  font-size: 2rem;
  font-weight: bold;
  color: var(--color-primary);
  margin: 0;
}

.config-content {
  background: var(--color-card-background);
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
}

.config-section {
  margin-bottom: 2rem;
}

.config-section h2 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
}

.setting-group {
  margin-bottom: 1rem;
}

.setting-group label {
  display: block;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--color-text);
}

.config-input,
.config-textarea,
.config-select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.875rem;
  background: white;
  transition: border-color 0.2s ease;
}

.config-input:focus,
.config-textarea:focus,
.config-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.1);
}

.config-textarea {
  resize: vertical;
  min-height: 80px;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: var(--color-primary);
  color: white;
  border-radius: 20px;
  font-size: 0.875rem;
}

.remove-tag {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 1rem;
  padding: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background 0.2s ease;
}

.remove-tag:hover {
  background: rgba(255, 255, 255, 0.2);
}

.add-tag-input {
  width: auto;
  min-width: 150px;
  padding: 0.25rem 0.75rem;
  border: 1px dashed var(--color-border);
  border-radius: 20px;
  font-size: 0.875rem;
  background: transparent;
}

.add-tag-input:focus {
  border-style: solid;
  border-color: var(--color-primary);
}

.config-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.save-btn,
.cancel-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.save-btn {
  background: var(--color-primary);
  color: white;
}

.save-btn:hover {
  background: #7c3aed;
  transform: translateY(-1px);
}

.cancel-btn {
  background: #f3f4f6;
  color: var(--color-text);
}

.cancel-btn:hover {
  background: #e5e7eb;
}

/* Responsive Design */
@media (max-width: 768px) {
  .workflow-config-page {
    padding: 1rem;
  }
  
  .config-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
  
  .config-title {
    font-size: 1.5rem;
  }
  
  .config-content {
    padding: 1rem;
  }
  
  .config-actions {
    flex-direction: column;
  }
  
  .save-btn,
  .cancel-btn {
    width: 100%;
  }
}
</style>
