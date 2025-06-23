<template>
  <div class="sort-dropdown">
    <label for="sort" class="sort-label">Sort by:</label>
    <select id="sort" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)">
      <option v-for="option in options" :key="option" :value="option">
        {{ option }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  options: string[];
}>();

defineEmits(['update:modelValue']);
</script>

<style scoped>
.sort-dropdown {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap; /* prevent line break */
  padding: 0 12px;
  background-color: var(--color-card-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  height: 40px;
  font-size: var(--font-size-small);
}

.sort-label {
  color: var(--color-text);
  font-size: var(--font-size-small);
  font-weight: 400;
}

select {
  background-color: var(--color-background);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 3px 10px;
  font-size: var(--font-size-small);
  outline: none;
}
 </style>
