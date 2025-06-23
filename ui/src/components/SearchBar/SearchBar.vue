  <script setup lang="ts">
defineProps<{
  placeholder?: string;
  modelValue: string;
}>();
defineEmits(['update:modelValue']);
</script>


<template>
  <div class="search-bar">
    <span class="search-icon">🔍</span>
    <input
      type="text"
      :placeholder="placeholder"
      :value="modelValue"
      @input="$emit('update:modelValue', $event.target.value)"
    />
  </div>
</template>


<style scoped>
.search-bar {
  width: 100%;
  background-color: var(--color-card-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  transition: border 0.2s ease;
}

.search-bar input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text);
  font-size: var(--font-size-small);
}

.search-bar input::placeholder {
  color: var(--color-placeholder);
}

.search-icon {
  margin-right: 8px;
  font-size: 1rem;
  color: var(--color-text-light);
}
</style>
