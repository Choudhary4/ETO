import sys

filepath = "/Users/saurabhkuntal/Downloads/theme_export__czwmwm-dc-myshopify-com-dawn__22JAN2026-0304pm/etodoorscorp-theme/sections/eto-product.liquid"
with open(filepath, "r") as f:
    lines = f.readlines()

# 1. Find the bounds of the tabs section
tabs_start = -1
tabs_end = -1
for i in range(len(lines)):
    if '<section class="eto-new-tabs-section"' in lines[i]:
        tabs_start = i
    if tabs_start != -1 and '</section>' in lines[i] and i > tabs_start + 10:
        tabs_end = i
        break

if tabs_start == -1 or tabs_end == -1:
    print("Could not find tabs section bounds")
    sys.exit(1)

tabs_lines = lines[tabs_start:tabs_end+1]

# 2. Find the JS script we added
js_start = -1
js_end = -1
for i in range(tabs_end + 1, len(lines)):
    if 'var tabs = document.querySelector' in lines[i]:
        # found it, go back to find <script>
        for j in range(i, i-10, -1):
            if '<script>' in lines[j]:
                js_start = j
                break
        # go forward to find </script>
        for j in range(i, i+10):
            if '</script>' in lines[j]:
                js_end = j
                break
        break

# 3. Find where to insert tabs (right after <div class="features">...</div>)
# We know the </section> of .details is right after features
details_end = -1
for i in range(len(lines)):
    if '<aside class="buybox"' in lines[i]:
        # the line before this should be </section> for .details
        for j in range(i-1, i-5, -1):
            if '</section>' in lines[j]:
                details_end = j
                break
        break

if details_end == -1:
    print("Could not find </section> of .details")
    sys.exit(1)

# 4. Find where to close eto-new-product-grid (after </aside>)
buybox_end = -1
for i in range(details_end + 1, len(lines)):
    if '</aside>' in lines[i]:
        buybox_end = i
        break

# Now construct the new file
new_lines = []
for i in range(len(lines)):
    if tabs_start <= i <= tabs_end:
        continue # skip old tabs
    
    if js_start != -1 and js_start <= i <= js_end:
        continue # skip JS

    # At the end of .details, insert tabs
    if i == details_end:
        # insert tabs BEFORE the </section> of .details
        new_lines.extend(tabs_lines)
        new_lines.append(lines[i])
        continue

    new_lines.append(lines[i])
    
    # After </aside>, ensure grid is closed
    if i == buybox_end:
        # Check if the next line is </div>, if not, add it
        if i + 1 < len(lines) and '</div>' not in lines[i+1] and '<!-- FAQ' not in lines[i+1]:
            # Actually, I know I removed the </div> at 2940 earlier, so let's just add it!
            new_lines.append("</div> <!-- closing eto-new-product-grid -->\n")

with open(filepath, "w") as f:
    f.writelines(new_lines)
print("Success!")
