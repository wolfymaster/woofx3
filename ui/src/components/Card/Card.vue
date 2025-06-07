<script setup lang="ts">
import { defineProps, ref } from 'vue';

const props = defineProps({
  type: { type: String, required: true },
  enabled: { type: Boolean, required: true },
  title: { type: String, required: true },
  showConfig: { type: Boolean, required: true },
  height: { type: String, default: '200px' },
  width: { type: String, default: '400px' },
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
    <div class="card-header">
      <h3>{{ props.title }}</h3>
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
  justify-content: space-between; /* Ensures the footer stays at the bottom */
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: 16px;
  margin: 16px;
  cursor: pointer;
  transition: box-shadow 0.3s ease;
  height: 100%;
}

.card:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}
.config-button {
  background-color: #ffffff;
  border: none;
  color: #6c757d; /* Light gray text */
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.config-button:hover {
  background-color: #f8f9fa; /* Slightly darker white on hover */
  color: #5a6268; /* Slightly darker gray on hover */
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