import { registerHooks } from 'node:module';
// The published core imports browser Kabelsalat. No synthesis is used here.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@kabelsalat/web') return { url: new URL('./kabelsalat-stub.mjs', import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
