<template>
  <div class="plugin-table">
    <PluginRow
       v-for="(plugin, index) in plugins"
        :key="index"
        v-bind="plugin"
        :class="index % 2 === 0 ? 'row-even' : 'row-odd'"
      @add="handleAdd(plugin)"
    />
  </div>
</template>

<script setup lang="ts">
import PluginRow from '../PluginRow/PluginRow.vue';

defineProps<{
  plugins: {
    name: string;
    developer: string;
    description: string;
    category: string;
    rating: number;
    icon: string;
  }[];
}>();

const emit = defineEmits(['add-to-workflow']);

const handleAdd = (plugin: any) => {
  emit('add-to-workflow', plugin);
};
</script>

<style scoped>
.plugin-table {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-medium);
}
.row-even {
  background-color: var(--plugin-row-light);
}
.row-odd {
  background-color: var(--plugin-row-dark);
}

</style>
