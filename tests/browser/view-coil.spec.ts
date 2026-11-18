import { test } from '@playwright/test';
import { viewSmoke } from './view-smoke';
viewSmoke(test, 'coil');

import { coilInteractions } from './view-coil.interactions';
coilInteractions(test);
