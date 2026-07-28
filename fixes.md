Recommended game plan

These issues should be handled as one onboarding and mobile-flow cleanup, not as separate cosmetic fixes.

1. Fix the account and free-trial flow first — critical

At present, a user can:

Register.
Confirm their email.
Enter Qwickly.
Immediately encounter “Subscription is required.”
Activate the trial.
Potentially see the onboarding tutorial again.

That creates a broken first impression.

The intended flow should be:

Register → confirm email → trial starts automatically → enter onboarding → complete setup → dashboard

My recommendation:

Automatically activate the 14-day free trial when the user confirms their email or first signs in.
Do not show the subscription-required screen during an active trial.
Keep the R129/month plan visible, but introduce it as what happens after the trial.
Never reset onboarding when the trial or subscription status changes.
Store these as independent states:
email_verified
trial_started
onboarding_started
onboarding_completed
subscription_status

The tutorial appearing again after trial activation strongly suggests that the subscription activation is resetting or incorrectly checking the onboarding state.

2. Rework onboarding progress so it reflects real completion

The progress bar should not advance because someone presses “Next.”

Each step should have an actual completion requirement:

Step Completion requirement
Business details Required business information saved
Services At least one service created
Staff At least one staff member created or owner assigned
Availability Working hours saved
Booking page Booking settings confirmed
Payments User enables deposits or explicitly skips
WhatsApp Connected or explicitly deferred

The progress indicator should be calculated from saved data, not from which page the user opened.

Also:

Remove the decorative icon from “Set up your business” if it adds unnecessary height on mobile.
Change vague buttons such as “Next: Services” to context-aware actions:
Save and continue
Add your first service
Continue without deposits
Users should still be allowed to skip optional steps, but Qwickly should clearly record that they skipped them. 3. Use a proper mobile drill-down pattern

The current “Back to settings” button is competing with the large onboarding card above it. On mobile, individual settings sections should behave like separate screens.

Recommended mobile structure:

← Settings
Notifications

[Settings content]

The back control should:

Sit at the top of the screen.
Be part of a fixed or sticky page header.
Appear before the onboarding card.
Use the same layout for Settings, Bot Setup, Payments and other nested pages.

The large onboarding card should not appear above the page navigation when the user is already inside a settings section. It can either be hidden on nested mobile screens or reduced to a small progress banner.

4. Change what happens when onboarding finishes

A toast saying “Setup complete! Welcome to Qwickly” while the user remains inside Settings feels unfinished.

After completion:

Mark onboarding as complete.
Show a brief success screen or modal.
Redirect the user to the dashboard.
Present one clear next action, such as:
View your booking page
Copy your booking link
Create a test booking

The toast can still appear after the redirect, but it should not be the entire completion experience.

5. Redesign WhatsApp setup around desktop and mobile separately

A QR code works on desktop because the user can scan it with their phone. It is not a complete mobile setup method because the QR code and WhatsApp are on the same device.

The setup screen should detect the device.

Desktop
Display the QR code.
Explain exactly where to scan it:
WhatsApp → Linked devices → Link a device
Show connection status and retry controls.
Mobile

Use one of these routes:

A phone-number pairing-code method, provided your WhatsApp integration supports it.
Ask the user to complete the connection later on a computer.
Let them display the QR code on another device.
Allow them to skip the connection without blocking the rest of onboarding.

Do not simply show the same QR code on mobile and leave the user stranded.

The mobile copy could say:

WhatsApp must be linked using a second screen. Open Qwickly on a computer to scan the QR code, or skip this step and connect it later.

The pairing-code route is worth asking Torben to investigate because it would provide the cleanest mobile experience.

6. Place WhatsApp after the business has usable information

The WhatsApp agent cannot provide useful answers when the business has no services, staff or availability.

Before WhatsApp setup, require or strongly encourage:

At least one service
At least one staff member
Business hours
Basic booking rules

The bot setup should then become a guided flow similar to onboarding:

Review business information.
Review services and staff.
Choose bot behaviour.
Connect WhatsApp.
Send a test message.
Enable review mode.

This is clearer than treating the WhatsApp connection as another unexplained settings toggle.

7. Audit payments before changing the UI

The deposits toggle should not remain visible unless its behaviour is understood and tested.

The audit needs to confirm:

What enabling deposits changes.
Whether it affects the public booking flow.
Whether the user can choose a fixed amount or percentage.
Which payment provider receives the payment.
What happens when payment succeeds, fails or is abandoned.
Whether bookings are created before or after payment.
Whether refunds and cancellations are supported.
Whether deposit information appears in confirmations and analytics.

Until this is confirmed, label it as Coming soon, hide it, or limit it to internal test accounts. A visible toggle that may not work is riskier than temporarily hiding the feature.

8. Fix the immediate mobile presentation bugs

These should follow the structural work:

Notification toggles

The label and control should not share a cramped horizontal row on narrow screens.

Use:

Appointment reminders
Send reminders before upcoming bookings.

[Toggle]

Allow the text to wrap and keep the toggle aligned separately.

Search/magnifying-glass popup

The popup should not be positioned relative to the left side of the icon when that causes overflow.

For mobile, use one of these:

A full-width search panel below the navbar.
A centred modal.
A full-screen command/search sheet.

Until it is functional, remove the magnifying-glass icon from mobile rather than keeping a visibly broken feature.

Bot Setup back button

Use the exact same mobile page header component as every other nested settings page. Do not solve it separately.

9. Update the confirmation email

The email should visually match Qwickly:

Qwickly logo
Brand colours and typography
Clear explanation of what confirmation does
A single strong Confirm email button
Explanation that the 14-day trial begins after confirmation
R129/month clearly stated for after the trial
Support/contact footer
Proper mobile responsiveness

The best confirmation behaviour is:

Confirm email → verified → trial activated → secure redirect into Qwickly

If automatic authentication from the email link is not safe or supported, redirect to /login with the email address prefilled. Do not prefill the password or place credentials in the URL.

Torben needs to confirm whether your authentication provider supports a secure verification link that also creates a logged-in session.

Priority order
P0 — Blocks new users
Automatically start the trial after verification or first login.
Remove the subscription wall during the trial.
Prevent trial activation from replaying onboarding.
Make onboarding progress dependent on saved data.
Confirm or hide the deposits functionality.
P1 — Mobile usability
Shared mobile header and back navigation.
Fix notification toggle layouts.
Replace the broken mobile search popup.
Design a mobile-safe WhatsApp linking route.
Redirect users to the dashboard after onboarding.
P2 — Clarity and polish
Rebrand the confirmation email.
Improve onboarding wording.
Remove unnecessary onboarding icons.
Add clear skip/defer states.
Add a post-onboarding success experience.
Testing process

All testing should be performed using genuinely clean accounts rather than accounts containing placeholder data.

Create separate test cases for:

New mobile user with no data.
New desktop user with no data.
Email verified but trial not yet activated.
Active trial user.
Returning user with partially completed onboarding.
User who skipped WhatsApp.
User who completed onboarding.
Expired-trial user.
Paid user.

The first immediate development ticket should be:

Rebuild the registration, trial and onboarding state flow so a newly verified user enters an active free trial, completes onboarding once, and reaches the dashboard without encountering a subscription wall.
