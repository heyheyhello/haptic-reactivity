// const o = require('ospec');
// require('./test/sGlobalTests.js');
// o.run();

import { boxes, rx, rxTree, adopt } from './src/sLocal.js';

const data = boxes({ label: 'Ok', count: 0 });
const r0 = rx(() => {
  console.log('Hey!', data.count());
});
console.log('r0', r0.sr);
console.log('rxTree', rxTree);

r0();

console.log('r0.unsubscribe');
r0.unsubscribe();

console.log('rxTree', rxTree);

data.count(10);

const r1 = rx(s => {
  console.log('Hey!', s(data.count));
});
console.log('r1', r1.sr);

console.log('rxTree', rxTree);

data.count(100);

// Pause
r1.unsubscribe();

console.log('data.count next');
data.count(101);
console.log('data.count next');
data.count(110);

// Start
r1();

console.log('data.count next');
data.count(111);

// This is an empty reaction that's in the OFF state (since it has no subs)
const lifeline = rx(() => {});
// When this reaction (re)runs, it *doesn't* register AttachTest as a child.
// Instead its adopted by `lifeline` who's responsible for handling the life of
// inner reactions...
console.log(`<div>
  ${s => s(data.count)
    ? adopt(lifeline, () => '<ComplexComponent/>')
    : '<p>Nothing to show</p>'
}
</div>`);

// Later...
lifeline.pause();
lifeline.unsubscribe();

// This is useful for building router-like or cache-like systems that don't
// recreate all sub connections each run. Here's one that's built into Haptic,
// called when(), that's a router used to preserve DOM trees

// Haptic's h engine isn't implemented here...
const h = v => v;
const when = (conditionFn, views) => {
  const rendered = {};
  const rxParents = {};
  let condDisplayed;
  return s => {
    const cond = conditionFn(s);
    if (cond === condDisplayed) {
      return rendered[cond];
    }
    // Tick. Pause reactions. Keep DOM intact.
    rxParents[condDisplayed].pause();
    condDisplayed = cond;
    // Rendered? Then Unpause. If nothing has changed then no sr/pr links change
    if (rendered[cond]) {
      rxParents[cond]();
      return rendered[cond];
    }
    // Able to render?
    if (views[cond]) {
      const parent = rx(() => {});
      rendered[cond] = adopt(parent, () => h(views[cond]));
      rxParents[cond] = parent;
      return rendered[cond];
    }
  };
};
console.log(`<div>
  ${when(s => s(data.count) ? 'T' : 'F', {
    T: () => '<ComplexComponent/>',
    F: () => '<p>Nothing to show</p>',
  })}
</div>`);
