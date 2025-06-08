<script lang="ts" setup>
import MyButton from '../Button/Button.vue';
import { ref } from 'vue';
import { useStore } from '@nanostores/vue'
import { onLogin, onLogout, onCreateAccount} from "@/features/LandingPage/store/landingPageStore.ts";
import { $defaultUserStore } from "@/features/LandingPage/store/landingPageStore.ts";
const userStore = useStore($defaultUserStore);
const currentTheme = ref('light');

const toggleTheme = () => {
  currentTheme.value = currentTheme.value === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme.value);
};
</script>

<template>
  <header>
    <div class="storybook-header">
      <div class="logo-container">
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <g fill="none" fill-rule="evenodd">
            <path
              d="M10 0h12a10 10 0 0110 10v12a10 10 0 01-10 10H10A10 10 0 010 22V10A10 10 0 0110 0z"
              fill="#FFF"
            />
            <path
              d="M5.3 10.6l10.4 6v11.1l-10.4-6v-11zm11.4-6.2l9.7 5.5-9.7 5.6V4.4z"
              fill="#555AB9"
            />
            <path
              d="M27.2 10.6v11.2l-10.5 6V16.5l10.5-6zM15.7 4.4v11L6 10l9.7-5.5z"
              fill="#91BAF8"
            />
          </g>
        </svg>
        <div @click="toggleTheme" class="theme-toggle">
          <div v-if="currentTheme === 'light'">
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <circle cx="16" cy="16" r="10" fill="#FFD700" />
            </svg>
          </div>
          <div v-else>
            <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <path
                  d="M16 2a14 14 0 1014 14A14 14 0 0016 2zm0 24a10 10 0 110-20 10 10 0 010 20z"
                  fill="#1E90FF"
              />
            </svg>
          </div>
      </div>
        <div>
          <h1>Woof X3</h1>
        </div>
      </div>

      <div>
        <span class="welcome" v-if="userStore.user"
          >Welcome, <b>{{ userStore.user.name }}</b
          >!</span
        >
        <my-button size="small" @click="onLogout" label="Log out" v-if="userStore.user" />
        <my-button size="small" @click="onLogin" label="Log in" v-if="!userStore.user" />
        <my-button
          primary
          size="small"
          @click="onCreateAccount"
          label="Sign up"
          v-if="!userStore.user"
        />
      </div>
    </div>
  </header>
</template>

<style>
.storybook-header {
  display: flex;
  background: var(--color-background);
  color: var(--color-text);
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  padding: 15px 20px;
  font-family: 'Nunito Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}
.logo-container{
  display: flex;
  align-items: flex-start;
}

.storybook-header svg {
  display: inline-block;
  vertical-align: top;
}

.storybook-header h1 {
  display: inline-block;
  vertical-align: top;
  margin: 6px 0 6px 10px;
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
}

.storybook-header button + button {
  margin-left: 10px;
}

.storybook-header .welcome {
  margin-right: 10px;
  color: #333;
  font-size: 14px;
}
</style>


