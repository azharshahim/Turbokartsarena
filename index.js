import { registerRootComponent } from 'expo';
import App from './App';

// Point d'entrée Expo : l'application entière vit dans App.tsx,
// le moteur 3D partagé dans src/ (utilisé aussi par la preview web).
registerRootComponent(App);
