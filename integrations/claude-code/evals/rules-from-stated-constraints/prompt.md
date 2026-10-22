---
tags: [stemma, rules]
max_turns: 60
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

We're building a clinic booking system: patients book on a web app or a mobile app, staff use a back-office app, there's a booking service, a scheduling service, a notification worker, a Postgres per service and RabbitMQ. Two things are non-negotiable for us: only the scheduling service may talk to the external EHR system, and none of the apps may talk to a database directly — everything goes through the API gateway. Model it in Stemma and make sure those rules are actually checked.
