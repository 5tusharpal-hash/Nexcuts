# PROFESSIONAL UI/UX COLOR BOOK
## COLOR USAGE, ACCESSIBILITY & COMPONENT GUIDELINES

Version 1.0

## 1. PURPOSE

This document defines how the application's color system must be used throughout the UI.

The objective is to:
- Maintain consistent branding.
- Prevent random HEX values.
- Ensure consistent buttons, forms, cards, alerts and navigation.
- Define light and dark themes.
- Make all interactive states predictable.
- Maintain accessible text/background contrast.
- Allow future theme changes without editing every component.

The five original brand colors are the foundation. Success, warning, error and info are supporting semantic colors and must remain independent of the brand palette.

## 2. COLOR SYSTEM ARCHITECTURE

Follow this hierarchy:

BRAND COLORS → COLOR SCALES → SEMANTIC TOKENS → COMPONENT TOKENS

1. Brand colors define the identity.
2. Color scales provide lighter and darker shades.
3. Semantic tokens define what a color means.
4. Component tokens define how an individual component uses it.

Example:

primary-500
    ↓
action-primary
    ↓
button-primary-bg
    ↓
Primary button background

Components should normally consume semantic or component tokens, not raw palette HEX values.

## 3. GENERAL COLOR DISTRIBUTION

The interface should be predominantly neutral.

Recommended visual balance:
- 65–75% neutral backgrounds and surfaces.
- 15–20% brand and supporting brand colors.
- 5–10% status colors, highlights and special accents.

These are visual guidelines, not mandatory mathematical limits.

The application should not look entirely green. Green should identify important actions and brand elements, while neutral colors provide breathing room and readability.

## 4. PRIMARY BRAND COLOR USAGE

Primary 500 (#8FB339) is the main brand action color.

Use for:
- Main CTA buttons.
- Important selected states.
- Active navigation indicators.
- Progress indicators.
- Selected checkboxes and radio buttons.
- Primary links when contrast permits.
- Important brand icons.
- Progress bars.

Do not use it for:
- Every heading.
- Every icon.
- Large page backgrounds.
- Every card border.
- Success notifications.

Primary buttons should be visually prominent, not excessively repeated.

## 5. SECONDARY BRAND COLOR USAGE

Secondary 500 (#4B5842) is the dark brand color.

Use for:
- Sidebar and navigation.
- Footer.
- Dark buttons.
- Strong headings.
- Strong supporting text.
- Dark branding sections.
- Dark theme surfaces.
- High-emphasis icons.

It should provide visual stability and contrast against the lighter primary and accent colors.

## 6. ACCENT COLOR USAGE

Accent 500 (#B7CE63) is a supporting highlight color.

Use for:
- Decorative highlights.
- Selected indicators.
- Feature highlights.
- Illustration accents.
- Small visual emphasis.
- Secondary chart series.
- Selected decorative elements.

Do not use Accent 500 with white text for important controls without verifying contrast.

For readable text on accent backgrounds, prefer a sufficiently dark neutral or secondary text token.

## 7. NEUTRAL COLOR USAGE

Neutral colors should make up most of the interface.

Use:
- Neutral 50–100 for page backgrounds.
- Neutral 200–300 for subtle surfaces.
- Neutral 400 for default borders.
- Neutral 500–600 for stronger borders and separators.
- Neutral 700–800 for muted elements.
- Neutral 900–950 for supporting dark text where appropriate.

Do not use neutral-700 or neutral-800 as ordinary body text without checking contrast on the selected background.

## 8. BACKGROUND RULES

Main page:
- Background: bg-page.
- Text: text-primary.

Normal card:
- Background: bg-surface.
- Border: border-default.
- Text: text-primary.

Secondary section:
- Background: bg-surface-muted.
- Text: text-primary.

Primary-tinted section:
- Background: bg-surface-primary.
- Text: text-primary.

Accent-tinted section:
- Background: bg-surface-accent.
- Text: text-primary.

Dark brand section:
- Background: bg-inverse.
- Text: text-inverse.

Never use the same visual intensity for the page, cards, dialogs and elevated surfaces. Their hierarchy should be visible.

## 9. TEXT COLOR RULES

Primary text:
- Use text-primary.
- Main headings, body text, important information.

Secondary text:
- Use text-secondary.
- Secondary headings, supporting labels and important metadata.

Muted text:
- Use text-muted.
- Descriptions, timestamps, helper information.

Disabled text:
- Use text-disabled.
- Disabled controls and unavailable information.

Inverse text:
- Use text-inverse.
- Text on dark or sufficiently dark brand surfaces.

Links:
- Use text-link.
- Hover uses text-link-hover.

Never use a light color for small text on a light background.

## 10. PRIMARY BUTTON

Default:
- Background: primary-500.
- Text: text-primary.
- Border: transparent.

Hover:
- Background: primary-600.
- Text: text-primary.

Active:
- Background: primary-700.
- Text: text-inverse.

Focus:
- Background: primary-500.
- Focus ring: primary-200.
- Focus ring width: approximately 3px.

Disabled:
- Background: neutral-300.
- Text: neutral-700.
- Border: neutral-400.
- No hover effect.

Important: Primary 500 is a relatively light green. White text on it may not provide sufficient contrast. Use a dark text token for the default button unless contrast testing proves otherwise.

## 11. SECONDARY BUTTON

Default:
- Background: secondary-500.
- Text: white.
- Border: transparent.

Hover:
- Background: secondary-600.
- Text: white.

Active:
- Background: secondary-700.
- Text: white.

Focus:
- Ring: secondary-200.

Disabled:
- Background: neutral-300.
- Text: neutral-700.

## 12. OUTLINE BUTTON

Default:
- Background: transparent.
- Border: primary-500.
- Text: primary-700.

Hover:
- Background: primary-50.
- Border: primary-600.
- Text: primary-800.

Active:
- Background: primary-100.
- Border: primary-700.
- Text: primary-900.

Disabled:
- Background: transparent.
- Border: neutral-400.
- Text: neutral-700.

## 13. GHOST BUTTON

Default:
- Background: transparent.
- Text: secondary-600.

Hover:
- Background: primary-50.
- Text: secondary-800.

Active:
- Background: primary-100.
- Text: secondary-900.

Disabled:
- Background: transparent.
- Text: neutral-700.

Use ghost buttons for low-emphasis actions such as Cancel, Back and secondary toolbar actions.

## 14. DESTRUCTIVE BUTTON

Default:
- Background: error-600.
- Text: white.

Hover:
- Background: error-700.
- Text: white.

Active:
- Background: error-800.
- Text: white.

Focus:
- Ring: error-200.

Disabled:
- Background: neutral-300.
- Text: neutral-700.

Use destructive styling only for genuinely destructive operations, such as deleting records or permanently removing data.

## 15. INPUT AND FORM CONTROLS

Normal:
- Background: input-bg.
- Border: input-border.
- Text: input-text.
- Placeholder: input-placeholder.

Hover:
- Border: input-border-hover.

Focus:
- Border: input-border-focus.
- Ring: input-focus-ring.

Error:
- Border: input-border-error.
- Ring: input-error-ring.
- Error message: error-700.

Success:
- Border: input-border-success.
- Ring: input-success-ring.

Disabled:
- Background: input-bg-disabled.
- Border: neutral-300.
- Text: neutral-700.

Validation messages must include text or an icon, not just a border color. Do not communicate errors using color alone.

## 16. ALERTS AND NOTIFICATIONS

All alerts should use the same structural design.

Success alert:
- Background: success-50.
- Border: success-200.
- Icon: success-600.
- Title: success-800.
- Description: success-700.

Warning alert:
- Background: warning-50.
- Border: warning-200.
- Icon: warning-600.
- Title: warning-800.
- Description: warning-700.

Error alert:
- Background: error-50.
- Border: error-200.
- Icon: error-600.
- Title: error-800.
- Description: error-700.

Info alert:
- Background: info-50.
- Border: info-200.
- Icon: info-600.
- Title: info-800.
- Description: info-700.

Alert rules:
- Never fill a large alert with a highly saturated status color.
- Use light backgrounds.
- Keep the border subtle.
- Use a recognizable icon.
- Give the alert a meaningful title.
- Use readable description text.
- Provide an action only when necessary.
- Make critical errors distinguishable from simple informational messages.

## 17. TOAST NOTIFICATIONS

Toast notifications should follow the same status color architecture as alerts.

Success: light green background and success icon.
Warning: light amber background and warning icon.
Error: light red background and error icon.
Info: light blue background and info icon.

Use:
- Short title.
- One concise description.
- Optional action.
- Close button where appropriate.

Avoid using fully saturated backgrounds for normal toast messages.

## 18. BADGES AND STATUS INDICATORS

Primary badge:
- Background: primary-50 or primary-100.
- Text: primary-800.
- Border: primary-200.

Success badge:
- Background: success-50.
- Text: success-700.
- Border: success-200.

Warning badge:
- Background: warning-50.
- Text: warning-700.
- Border: warning-200.

Error badge:
- Background: error-50.
- Text: error-700.
- Border: error-200.

Info badge:
- Background: info-50.
- Text: info-700.
- Border: info-200.

Badges should remain compact. Avoid using strong saturated colors as the entire badge background unless a specific high-emphasis status requires it.

## 19. CARDS

Normal card:
- Background: white.
- Border: neutral-400.
- Text: text-primary.

Hoverable card:
- Background: white.
- Border: primary-300 on hover.

Selected card:
- Background: primary-50.
- Border: primary-500.

Featured card:
- Background: accent-50.
- Border: accent-300.

Dark card:
- Background: secondary-900.
- Border: secondary-700.
- Main text: white.
- Supporting text: neutral-300.

Do not add green borders to every card. Reserve primary borders for selected or interactive states.

## 20. TABLES AND DATA LISTS

Table header:
- Background: neutral-100.
- Text: secondary-800.

Table body:
- Background: white.
- Text: text-primary.

Table border:
- border-subtle.

Row hover:
- Background: primary-50.

Selected row:
- Background: primary-100.

Disabled row:
- Text: text-disabled.

Status columns:
- Use semantic badges for status.
- Do not color the entire row for ordinary status changes.

## 21. NAVIGATION AND SIDEBAR

Light navigation:
- Background: white.
- Text: secondary-700.
- Active background: primary-50.
- Active text: primary-800.
- Active indicator: primary-500.
- Hover background: neutral-100.

Dark navigation:
- Background: secondary-900.
- Text: neutral-300.
- Active background: secondary-800.
- Active text: accent-300.
- Active indicator: primary-500.
- Hover background: secondary-800.

## 22. ICON RULES

Normal icons:
- icon-primary.

Secondary icons:
- icon-secondary.

Muted icons:
- icon-muted.

Primary action icons:
- icon-brand.

Status icons:
- Corresponding semantic 600 shade.

Inverse icons:
- icon-inverse.

Disabled icons:
- icon-disabled.

Icons should communicate the same meaning as their accompanying text. Do not rely on a color difference alone.

## 23. LINKS

Default:
- text-link.

Hover:
- text-link-hover.

Visited:
- secondary-700.

Focus:
- Primary focus ring.

Use underlines where needed, particularly for inline links in long-form content.

## 24. FOCUS AND ACCESSIBILITY

All interactive components must have a visible keyboard focus state.

Standard focus:
- Border: primary-500.
- Ring: primary-200.
- Ring width: approximately 3px.

Semantic focus:
- Error controls use error-500 with error-200 ring.
- Success controls use success-500 with success-200 ring.

Accessibility requirements:
- Normal text should target a minimum contrast ratio of 4.5:1.
- Large text should target 3:1.
- Important UI boundaries and graphical controls should target 3:1 against adjacent colors.
- Do not communicate status using color alone.
- Use text, icons, labels or patterns in addition to color.
- Test actual color combinations, not individual colors in isolation.
- Check both light and dark themes.

Do not assume every suggested palette combination automatically meets WCAG contrast requirements. Verify combinations before production.

## 25. DARK THEME RULES

Do not simply invert the light theme.

Use dedicated dark surfaces.

Page:
- dark-bg-page.

Cards:
- dark-bg-surface.

Elevated cards:
- dark-bg-surface-elevated.

Borders:
- dark-border-default.

Main text:
- dark-text-primary.

Supporting text:
- dark-text-secondary.

Muted text:
- dark-text-muted.

Primary action:
- dark-action-primary.
- Text: dark-action-primary-text.

Accent:
- Use accent-400 or accent-500 for highlights.

Dark status alerts:
- Use the dedicated dark status background, border and text tokens.

Avoid pure black backgrounds. The dark olive/green neutral foundation is more consistent with the brand.

## 26. INVERSE COLOR RULES

Inverse colors are used when a component switches from the normal light surface to a dark surface.

Dark navigation:
- Background: secondary-500 or secondary-900.
- Main text: white.
- Muted text: neutral-300.
- Brand accent: accent-300.

Primary button:
- Background: primary-500.
- Text: primary-950 or another contrast-verified dark text token.

Accent background:
- Background: accent-500.
- Text: secondary-950.

Never assume white is the correct text color on every colored background.

## 27. CHARTS AND DATA VISUALIZATION

The brand is predominantly green, so charts require additional distinct colors.

Use the documented chart palette.

Rules:
- Do not use several nearly identical greens for adjacent data series.
- Use distinct line styles or markers when needed.
- Use labels and legends.
- Reserve semantic status colors for meaningful status data.
- Maintain sufficient contrast.
- Avoid using red and green as the only distinction between categories.

## 28. COLOR COMBINATION GUIDELINES

Default light application:
- Page: #FDFDFD.
- Cards: #FFFFFF.
- Text: #293229.
- Primary action: #8FB339.
- Secondary brand: #4B5842.
- Borders: #E5E7E4.

Brand-focused section:
- Dark background: #4B5842.
- Main text: #FFFFFF.
- Supporting text: #DADDD8.
- Accent: #C7D59F.
- Highlight: #B7CE63.

Dark application:
- Page: #202720.
- Cards: #293229.
- Elevated: #333D2F.
- Border: #43503B.
- Text: #F7F9F6.
- Primary: #8FB339.
- Accent: #B7CE63.

Accent section:
- Background: #F8FAEF.
- Highlight: #B7CE63.
- Text: #293229.
- Border: #DFE9B9.

## 29. COLOR USAGE PROHIBITIONS

Never:
- Add random HEX values directly into components.
- Use primary green for every button, icon and heading.
- Use saturated error colors for large backgrounds.
- Use success green for ordinary brand decoration.
- Use warning yellow for decorative highlights that have no warning meaning.
- Use different focus colors for every component.
- Use white text on light colors without checking contrast.
- Use raw black as the default text color.
- Use pure black as the default dark page background.
- Make every card border green.
- Communicate errors or success only through color.
- Create one-off hover colors without documenting them.

## 30. DEVELOPER IMPLEMENTATION RULES

Use three layers:

Layer 1 — Palette:
primary-500, secondary-500, accent-500, neutral-400, success-500, warning-500, error-500, info-500.

Layer 2 — Semantic:
bg-page, bg-surface, text-primary, text-muted, border-default, action-primary, state-success, state-error.

Layer 3 — Component:
button-primary-bg, button-primary-hover, input-border, input-focus, card-border, alert-error-bg.

Components should use Layer 2 or Layer 3 wherever possible.

Layer 1 should normally be accessed when creating or maintaining the theme itself.

## 31. CSS IMPLEMENTATION CONVENTIONS

Use CSS custom properties as the single source of truth.

Example:

:root {
  --color-primary-500: #8FB339;
  --color-secondary-500: #4B5842;
  --color-accent-500: #B7CE63;
  --color-neutral-400: #E5E7E4;

  --color-bg-page: #FDFDFD;
  --color-bg-surface: #FFFFFF;

  --color-text-primary: #293229;
  --color-text-secondary: #4B5842;

  --color-border-default: #E5E7E4;

  --color-action-primary: #8FB339;
  --color-action-primary-hover: #85A53A;
}

Components should reference these variables instead of defining their own HEX values.

For Tailwind projects, expose the CSS variables through the theme configuration and use semantic utility classes.

## 32. NAMING CONVENTIONS

Use:
- primary-500
- bg-page
- bg-surface
- text-primary
- text-muted
- border-default
- action-primary
- action-primary-hover
- state-success
- state-error
- button-primary-bg
- input-border
- alert-error-bg

Avoid:
- green-color-1
- light-green-new
- custom-green
- button-green-2
- random-bg
- final-color
- new-primary

Names should describe purpose, not appearance alone.

## 33. FINAL DESIGN SYSTEM RULE

Every color must have a documented purpose.

Every component must use a documented token.

Every interactive component must have predictable states.

Every status must use the correct semantic color.

Every theme must have its own tested background, text, border and action combinations.

Never introduce an undocumented HEX code into production UI.

The design system is the single source of truth for all colors across the application.

END OF COLOR USAGE GUIDELINES