import os
import re
import glob

# Files to update
files_to_check = glob.glob('sections/*.liquid') + glob.glob('assets/*.css')

# Regex to find max-width: 1200px, 1400px, 1270px that are NOT part of @media
# Negative lookbehind for '@media ' or '@media screen and ' etc is hard in re.
# Better approach: Iterate lines, if line contains '@media', skip it.
# Otherwise, replace max-width: 1200px, etc. with var(--eto-container-max)

pattern = re.compile(r'max-width:\s*(1200|1400|1270|1114)px;?')

for file in files_to_check:
    try:
        with open(file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            
        changed = False
        new_lines = []
        for line in lines:
            if '@media' in line:
                new_lines.append(line)
            else:
                new_line = pattern.sub('max-width: var(--eto-container-max);', line)
                
                # Also try to replace "padding: 0 20px;" with "padding: 0 var(--eto-margin-edge);"
                # only if we matched a max-width change, or just generally? No, too risky.
                
                if new_line != line:
                    changed = True
                new_lines.append(new_line)
                
        if changed:
            with open(file, 'w', encoding='utf-8') as f:
                f.writelines(new_lines)
            print(f"Updated {file}")
            
    except Exception as e:
        print(f"Error processing {file}: {e}")

print("Done")
