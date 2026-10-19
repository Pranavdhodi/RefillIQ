# RefillIQ

Predicts when households will need an LPG refill and plans the shortest delivery
route for distributors.

**Live demo:** https://pranavdhodi.github.io/RefillIQ/

Built as a first-year student project for HPCL's HP Power Lab. All demo data is
simulated. No real customer data is used.

## The problem
LPG distributors usually deliver after a customer calls. Customers run out
unexpectedly, and delivery vans take longer routes than they need to.

## What it does
- Add a household with just a name, area, number of people and past refill dates
- Predicts when each cylinder will run out and flags overdue, urgent and due-soon households
- Plans a delivery loop from the depot using 2-opt route optimisation
- Compares the route with an unoptimised order: [X] km vs [Y] km on the sample data
- Imports households from Excel or CSV, with a preview before anything is added
- You can place the depot on the map

## How to use it
1. Open the live demo and click **Load Sample Data**
2. Open **Route Optimization** to see the before and after routes
3. Use **Add Household** or **Import Excel / CSV** to try your own data

## Built with
HTML, CSS and JavaScript (no framework). Runs entirely in the browser.

## Limitations
- Distances are estimated, not real road routes
- Data is saved in the browser only

## Next steps
Real road distances, a machine learning forecast tested on held-out data, and
WhatsApp reminders to customers.
