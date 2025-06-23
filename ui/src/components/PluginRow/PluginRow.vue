<template>
  <div class="plugin-row">
    <img :src="icon" alt="Plugin Icon" class="plugin-icon" />
    <div class="plugin-content">
      <div class="plugin-title">
        <strong>{{ name }}</strong> <span class="developer">by {{ developer }}</span>
      </div>
      <p class="plugin-description">{{ description }}</p>
      <div class="plugin-meta">
        <span class="badge">{{ category }}</span>
        <span class="rating">{{ rating }} ⭐</span>
      </div>
    </div>
    <button class="workflow-button" @click="onAdd">Add to Workflow</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  developer: string;
  description: string;
  category: string;
  rating: number;
  icon: string;
}>();

const emit = defineEmits(['add']);
const onAdd = () => emit('add');
</script>

<style scoped>
.plugin-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-medium);
  padding: var(--spacing-large);
  background: var(--color-card-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  box-shadow: var(--box-shadow);
}

.plugin-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--border-radius);
  object-fit: contain;
  background: var(--color-background);
}

.plugin-content {
  flex: 1;
  color: gold;
}

.plugin-title {
  color: var(--color-text);
  font-size: var(--font-size-medium);
}

.developer {
  color: var(--color-text-light);
  font-size: var(--font-size-small);
  margin-left: 4px;
}

.plugin-description {
  color: var(--color-text-light);
  font-size: var(--font-size-small);
  margin: 4px 0;
}

.plugin-meta {
  display: flex;
  gap: var(--spacing-small);
  align-items: center;
}

.badge {
  background-color: var(--color-badge-background);
  color: var(--color-badge-text);
  padding: 2px 8px;
  border-radius: var(--border-radius);
  font-size: var(--font-size-small);
}

.rating {
  color: var(--color-star);
  font-weight: bold;
  font-size: var(--font-size-small);
}

.workflow-button {
  background-color: var(--color-button-background);
  color: white;
  padding: 8px 12px;
  border: none;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: var(--font-size-small);
}
</style>
