<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { viewModeStore } from '../../Workflows/store/workflowsStore';

const defaultView = ref<'cards' | 'table'>('cards');

onMounted(() => {
  // Load saved default view from localStorage
  const saved = localStorage.getItem('workflowDefaultView');
  if (saved && (saved === 'cards' || saved === 'table')) {
    defaultView.value = saved;
  }
});

const saveDefaultView = () => {
  localStorage.setItem('workflowDefaultView', defaultView.value);
  // Update the current view mode if we're on the workflows page
  viewModeStore.set(defaultView.value);
};
</script>

<template>
  <div class="settings-page">
    <h1 class="settings-title">Settings</h1>
    
    <div class="settings-content">
      <div class="settings-section">
        <h2>Workflow Settings</h2>
        
        <div class="setting-group">
          <label for="defaultView">Default Workflow View:</label>
          <select 
            id="defaultView"
            v-model="defaultView" 
            @change="saveDefaultView"
            class="setting-select"
          >
            <option value="cards">Pinned Workflows (Cards)</option>
            <option value="table">All Workflows (Table)</option>
          </select>
          <p class="setting-description">
            Choose which view to show by default when visiting the Workflows page.
          </p>
        </div>
      </div>
      
      <div class="settings-section">
        <h2>About</h2>
        <p class="about-text">
          Woofyx3 - Stream Management Platform<br>
          Version 1.0.0
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
}

.settings-title {
  font-size: 2.5rem;
  font-weight: bold;
  color: var(--color-primary);
  margin: 0 0 2rem 0;
  text-align: center;
}

.settings-content {
  background: var(--color-card-background);
  border-radius: 12px;
  padding: 2rem;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
}

.settings-section {
  margin-bottom: 2rem;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-section h2 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.5rem;
}

.setting-group {
  margin-bottom: 1.5rem;
}

.setting-group label {
  display: block;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--color-text);
}

.setting-select {
  width: 100%;
  max-width: 300px;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  font-size: 0.875rem;
  background: white;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.setting-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.1);
}

.setting-description {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-body-text);
  line-height: 1.4;
}

.about-text {
  color: var(--color-body-text);
  line-height: 1.6;
}

/* Responsive Design */
@media (max-width: 768px) {
  .settings-page {
    padding: 1rem;
  }
  
  .settings-title {
    font-size: 2rem;
  }
  
  .settings-content {
    padding: 1rem;
  }
  
  .setting-select {
    max-width: none;
  }
}
</style>