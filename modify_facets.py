import re

with open('/Users/saurabhkuntal/Downloads/theme_export__czwmwm-dc-myshopify-com-dawn__22JAN2026-0304pm/etodoorscorp-theme/snippets/facets.liquid', 'r') as f:
    content = f.read()

# Find the loop
start_marker = "{% comment %} Filters for both horizontal and vertical filter {% endcomment %}"
end_marker = "{%- endfor -%}\n          </div>\n\n\n          {% comment %} Pills after filtes on filter type horizontal {% endcomment %}"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker) + len("{%- endfor -%}")

if start_idx != -1 and end_idx != -1:
    loop_content = content[start_idx:end_idx]
    
    # We will create two loops from this loop.
    # The first loop will have `{% if filter.type != 'price_range' %}{% continue %}{% endif %}`
    # The second loop will have `{% if filter.type == 'price_range' %}{% continue %}{% endif %}`
    
    # Let's find where to insert the condition.
    # After `{% if filter_label_down == 'availability' or filter_label_down == 'product category' %}{% continue %}{% endif %}`
    
    insert_marker = "{% if filter_label_down == 'availability' or filter_label_down == 'product category' %}{% continue %}{% endif %}"
    
    if insert_marker in loop_content:
        loop1 = loop_content.replace(insert_marker, insert_marker + "\n              {% if filter.type != 'price_range' %}{% continue %}{% endif %}")
        loop2 = loop_content.replace(insert_marker, insert_marker + "\n              {% if filter.type == 'price_range' %}{% continue %}{% endif %}")
        
        # We need to replace `forloop.index` with `forloop.index | plus: 100` in loop2 to avoid ID conflicts, 
        # or it doesn't matter because we skip elements but forloop.index stays unique per loop.
        # Actually `forloop.index` is based on the iteration. Since we skip, `forloop.index` will be 1,2,3 for price, and 1,2,3 for others.
        # To avoid ID conflicts, let's append `-price` to loop1 and `-other` to loop2.
        # Actually, if we just do:
        loop1 = loop1.replace('forloop.index', 'filter.param_name')
        loop2 = loop2.replace('forloop.index', 'filter.param_name')
        
        new_content = start_marker + "\n" + loop1.replace(start_marker, "{% comment %} Price filter first {% endcomment %}") + "\n\n" + loop2.replace(start_marker, "{% comment %} Other filters {% endcomment %}")
        
        content = content[:start_idx] + new_content + content[end_idx:]
        
        with open('/Users/saurabhkuntal/Downloads/theme_export__czwmwm-dc-myshopify-com-dawn__22JAN2026-0304pm/etodoorscorp-theme/snippets/facets.liquid', 'w') as f:
            f.write(content)
        print("Success")
    else:
        print("Insert marker not found")
else:
    print("Loop not found")
