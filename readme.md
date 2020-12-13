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

Unlike those libraries, there is no automatic memory management yet. There might
not be. It seems wasteful to destroy all reaction linkings every run, but then
again, it's also a lot of work to do consistency checks every run...
