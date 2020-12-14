# Haptic's reactivity engine

Implements the push-pull reactive programming model. Uses "Boxes" to store data
and "Reaction" functions which do work. Reactions can read boxes in a neutral
way, called a pass-read, or, in a way that subscribes them to box updates,
called a subscribe-read. Writing a value to a box causes it to call all
subscribed reactions (the push), even if the value hasn't changed. Each time a
reaction runs it reads from boxes (pull). Its subscribe-reads are compared to
those of its previous run and unused boxes are automatically unsubscribed. If
there are no more subscriptions after a run then the reaction is removed. You
can also remove a reaction manually. Reactions take down any children reactions
which were created during their runs.

Explicit subscriptions avoid accidental reaction calls that were an issue in
Haptic's previous "Signal" reactivity model (from Sinuous/Solid/S.js)

Like those libraries, it uses "automatic memory management" which seems wasteful
since it destroys all reaction linkings every run, but it is simple at least.

It's small:

```
 work [!] is 📦 v0.0.0 via ⬢ v14.2.0
❯ esbuild src/sLocal.js --minify --format=esm | gzip -9 | wc -c                                           (base)
475

 work [!] is 📦 v0.0.0 via ⬢ v14.2.0
❯ esbuild src/sLocal.js --minify --format=esm | wc -c                                                     (base)
855
```

Hopefully brings down Haptic's size, although I still have features to implement
and Haptic/s is 560min+gz and 1238min...

