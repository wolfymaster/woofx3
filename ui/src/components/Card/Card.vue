<script setup lang="ts">
import { defineProps, ref } from 'vue';

const props = defineProps({
  type: { type: String, required: true },
  enabled: { type: Boolean, required: true },
  title: { type: String, required: true },
  showConfig: { type: Boolean, required: true },
  description: { type: String, default: '' },
  height: { type: String, default: 'auto' },
  width: { type: String, default: '300px' },
  logo: { type: String, default: '' },
  tags: {
    type: Array as () => Array<{ title: string; color?: string }>,
    default: () => []
  },
});
const isEnabled = ref(props.enabled);
const emit = defineEmits<{
  (e: 'update:enabled', value: boolean): void;
}>();

const updateCheckboxValue = (checked: boolean) => {
  isEnabled.value = !checked;
  emit('update:enabled', checked);
};
</script>

<template>
  <div class="card" :style="{ height: props.height, width: props.width }">
    <div class="card-header" :class="{ 'full-height-header': props.type !== 'module' }">
      <img v-if="props.logo" :src="props.logo" alt="Module logo" class="module-logo" />
      <h2>{{ props.title }}</h2>
    </div>
    <div class="card-content" v-if="props.type === 'module'">
     <p v-if="props.description.length"> {{ props.description }} </p>
      <div class="tag-section">
        <div v-for="tag in props.tags" class="tag"  :key="tag.title">
          {{ tag.title }}
        </div>
      </div>
    </div>
    <div class="card-footer">
      <button v-if="props.showConfig" class="config-button">Configure</button>
      <div v-if="!props.showConfig"></div>
      <div>
        <div class="toggle-switch-container">
          <div>
            <span v-if="props.enabled">Enabled</span>
            <span v-if="!props.enabled">Disabled</span>
          </div>
        <label class="switch">
          <input
              id="default-payout-radio"
              :value="props.enabled"
              :checked="props.enabled"
              type="checkbox"
              @input="updateCheckboxValue($event.target.checked)"
          />
          <span class="slider round"></span>
        </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background-color: var(--color-card-background);
  border-radius: 16px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.05);
  padding: 24px;
  margin: 16px;
  width: 300px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.card-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(white);
  margin: 0;
}

.card-content {
  margin-bottom: 16px;
}

.card-content p {
  font-size: 0.95rem;
  color: var(--color-body-text);
  margin: 0;
  line-height: 1.5;
}

.tag-section {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.tag {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  color: #9333ea;
  background-color: #f3ebfd;
}

.config-button {
  background-color: #9333ea;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}


/* Hide default HTML checkbox */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #e0e0e0;
  transition: 0.4s;
  border-radius: 34px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: #9333ea;
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #e9d5ff;
}

input:checked + .slider:before {
  transform: translateX(20px);
  background-color: #9333ea;
}

.toggle-switch-container span {
  font-size: 0.85rem;
  font-weight: 500;
  color: #9333ea;
}

.module-logo {
  width: 40px;
  height: 40px;
  margin-right: 10px;
  border-radius: 8px;
  object-fit: cover;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

</style>