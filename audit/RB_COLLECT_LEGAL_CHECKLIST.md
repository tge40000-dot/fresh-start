# RB Collect: questions for a lawyer before it goes live

RB Collect (`/rewards`) is a collect-the-set prize game. It is **switched off**, and the owner has decided it stays off until a lawyer has reviewed the rules at `relentlessbillionaire.com/rewards/rules`. This list collects what that review should cover, quoting what the rules say today. It is not legal advice. It only lists the questions.

## What the game is

- Players get "plays". Each play draws a piece of a set, and a complete set claims that set's prize. One piece per set is rare (1 in 50 by default).
- The rules say: "NO PURCHASE OR MEMBERSHIP NECESSARY TO PLAY OR WIN. A purchase, donation or membership does not improve the odds of any play."
- **Free plays:**
  - one a day when you sign in;
  - 3 on your first sign-in;
  - 2 for joining the RB list;
  - 2 for each friend you refer, up to 10 a month;
  - codes handed out at shows.
- **Plays tied to money:**
  - 2 plays per $5 donated, up to 40;
  - 1 play per $10 spent in the store, up to 20;
  - 2 extra plays a day while an RB Studio membership is active;
  - 5 plays for joining a membership waitlist.
- **Eligibility:** US residents, 18 or older, one account each, with a verified email.

## Questions

1. **Sweepstakes or not.** Chance (random pieces), a prize and a possible "consideration" (plays earned by buying, donating or subscribing) are the classic three parts of an illegal lottery. Is the free route (a daily free play, plus the free ways above) a real alternative method of entry with equal dignity? A paid route gives more plays, so do the odds per player change even though the odds per play don't?
2. **Donations.** Plays for donations to `/fund`: does that raise charitable-raffle or solicitation rules in California or elsewhere?
3. **Registration and bonding.** Some states require sweepstakes with larger total prizes to be registered and bonded before they start (New York and Florida above $5,000; Rhode Island for retail promotions). What prize total keeps RB out of that, or what filing does it need?
4. **Official rules.** Do they need:
   - the sponsor's legal name and mailing address (today it's "Relentless Billionaire, relentlessbillionaire.com");
   - each prize's approximate retail value;
   - total prizes;
   - fixed start and end dates (today "not set yet");
   - a winners-list request address;
   - a governing-law clause?
5. **Odds disclosure.** Is "1 in 50 for the rare piece", plus the number of sets, enough? Or are odds of winning a prize per play, or over a typical month of free play, needed?
6. **Taxes.** Winners of prizes worth $600 or more in a year need a W-9 and a 1099. Should the rules say so and collect the details?
7. **Referrals.** Do the referral plays need extra terms (no spam, CAN-SPAM, TCPA if texted)?
8. **Minors and age checks.** Is "18 or older" plus a verified email enough? Does the claim step need ID?
9. **Void where prohibited.** Should any states be excluded outright?
10. **Changes and ending.** Can the game be changed mid-run, as the rules allow today ("RB may change or end RB Collect")? Or do the rules have to be fixed once it starts?

## How to switch it on once it's cleared

1. Add the prizes and their quantities in RB Command > Rewards, with real items and values.
2. Set the start and end dates.
3. Set `reward_config.enabled` to `on`.

Until all three are done, the page says "coming soon" and nothing can be played.
