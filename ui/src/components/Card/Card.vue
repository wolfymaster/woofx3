<script setup lang="ts">
import { defineProps, ref } from 'vue';

const props = defineProps({
  type: { type: String, required: true },
  enabled: { type: Boolean, required: true },
  title: { type: String, required: true },
  showConfig: { type: Boolean, required: true },
  description: { type: String, default: '' },
  height: { type: String, default: 'auto' },
  width: { type: String, default: '400px' },
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
      <h2>{{ props.title }}</h2>
    </div>
    <div class="card-content" v-if="props.type === 'module'">
     <p v-if="props.description.length"> {{ props.description }} </p>
      <div class="tag-section">
        <div v-for="tag in props.tags" class="tag" :style="{ backgroundColor: tag.color || '#e0e0e0' }" :key="tag.title">
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
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06);
  padding: 20px;
  margin: 16px;
  cursor: pointer;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.card:hover {
  transform: translateY(-5px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15), 0 3px 6px rgba(0, 0, 0, 0.1);
}
.full-height-header {
  flex: 1;
}

.card-header {
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.card-header h2 {
  font-size: 1.5rem;
  font-weight: 600;
  color: #333;
}

.card-content p {
  font-size: 1rem;
  color: #555;
  line-height: 1.5;
}

.tag-section {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}

.tag {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #fff;
  background-color: #007bff;
  transition: background-color 0.3s ease;
}

.tag:hover {
  background-color: #0056b3;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.config-button {
  background-color: #007bff;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.config-button:hover {
  background-color: #0056b3;
}

.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 26px;
}

/* Hide default HTML checkbox */
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

/* The slider */
.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  -webkit-transition: 0.5s;
  transition: 0.5s;
  border: solid 1px #cacfd3;
}

.slider:before {
  position: absolute;
  content: '';
  height: 18px;
  width: 18px;
  left: 4px;
  bottom: 3px;
  -webkit-transition: 0.5s;
  transition: 0.5s;
}

input:checked + .slider {
  background-color: #2c3e50;
}

input:focus + .slider {
  box-shadow: 0 0 1px #2196f3;
}

input:checked + .slider:before {
  -webkit-transform: translateX(23px);
  -ms-transform: translateX(23px);
  transform: translateX(23px);
  background-color: #ffffff;
}

/* Rounded sliders */
.slider.round {
  border-radius: 34px;
}

.slider.round:before {
  border-radius: 50%;
  background-color: #2c3e50;
}
.toggle-switch-container {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>