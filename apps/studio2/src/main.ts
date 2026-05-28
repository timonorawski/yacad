import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');
mount(App, { target: root });
