#!/usr/bin/env python3
"""
Linux Accessibility Query Tool using AT-SPI2

Usage:
  python3 atspi-query.py query <x> <y>
  python3 atspi-query.py search <keyword>
  python3 atspi-query.py state

Requires:
  sudo apt install -y python3 python3-gi python3-pip
  pip3 install pyatspi
"""

import sys
import json
import math
import argparse
from typing import Optional, List, Dict, Any

try:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "AT-SPI2 not available. Install: pip3 install pyatspi"
    }))
    sys.exit(1)


def get_element_role(element: Atspi.Accessible) -> str:
    """Get normalized role for element"""
    try:
        role = element.get_role_name()
        role_map = {
            'push button': 'button',
            'check box': 'checkbox',
            'radio button': 'radiobutton',
            'combo box': 'combobox',
            'text': 'textfield',
            'entry': 'textfield',
            'password text': 'textfield',
            'list': 'list',
            'list item': 'listitem',
            'table': 'table',
            'table cell': 'cell',
            'menu': 'menu',
            'menu item': 'menuitem',
            'menu bar': 'menubar',
            'tool bar': 'toolbar',
            'window': 'window',
            'frame': 'window',
            'dialog': 'dialog',
            'page tab': 'tab',
            'page tab list': 'tablist',
            'scroll bar': 'scrollbar',
            'slider': 'slider',
            'link': 'link',
            'image': 'image',
            'label': 'label',
            'section': 'group',
            'panel': 'group',
            'icon': 'image',
            'document': 'document',
            'paragraph': 'text',
            'heading': 'heading',
            'fill': 'unknown',
            'layered pane': 'group',
            'option pane': 'panel',
            'color chooser': 'colorchooser',
            'file chooser': 'filechooser',
            'separator': 'separator',
            'toggle button': 'togglebutton',
            'spin button': 'spinbutton',
            'tree': 'tree',
            'tree table': 'treetable',
        }
        return role_map.get(role.lower(), 'unknown')
    except:
        return 'unknown'


def get_element_info(element: Atspi.Accessible, x: int, y: int) -> Dict[str, Any]:
    """Get element information"""
    try:
        # Get component interface for bounds
        comp = element.queryComponent()
        if comp:
            extents = comp.getExtents(Atspi.CoordType.screen)
            bounds_x, bounds_y = extents.x, extents.y
            bounds_w, bounds_h = extents.width, extents.height
        else:
            bounds_x = bounds_y = bounds_w = bounds_h = 0

        # Calculate distance from query point
        center_x = bounds_x + bounds_w / 2
        center_y = bounds_y + bounds_h / 2
        distance = math.sqrt((center_x - x) ** 2 + (center_y - y) ** 2)

        # Get accessible name
        try:
            name = element.get_name() or ''
        except:
            name = ''

        # Get description
        try:
            description = element.get_description() or ''
        except:
            description = ''

        # Get role
        role = get_element_role(element)

        # Get value if available
        value = ''
        try:
            action = element.queryAction()
            if action:
                pass
        except:
            pass

        try:
            text = element.queryText()
            if text:
                value = text.get_text(0, 100)
        except:
            pass

        # Check if enabled
        try:
            state = element.get_state()
            is_enabled = Atspi.StateType.ENABLED in state
        except:
            is_enabled = True

        return {
            "role": role,
            "title": name,
            "description": description,
            "value": value,
            "x": bounds_x,
            "y": bounds_y,
            "width": bounds_w,
            "height": bounds_h,
            "distance": distance,
            "enabled": is_enabled
        }
    except Exception as e:
        return {
            "role": "unknown",
            "title": "",
            "description": str(e),
            "value": "",
            "x": 0,
            "y": 0,
            "width": 0,
            "height": 0,
            "distance": float('inf'),
            "enabled": True
        }


def query_at_point(x: int, y: int) -> Dict[str, Any]:
    """Query element at specified screen coordinates"""
    Atspi.init()

    # Get desktop
    desktop = Atspi.get_desktop(0)

    # Try to get element at point
    try:
        element = desktop.get_element_at_point(x, y)
        if element:
            element_info = get_element_info(element, x, y)
            element_info['similarity'] = 1.0 if element_info['distance'] < 50 else 0.5
    except Exception as e:
        # Fallback: search through all applications
        element = None
        for app in desktop:
            try:
                for window in app:
                    element = window.get_element_at_point(x, y)
                    if element and element.get_role_name():
                        element_info = get_element_info(element, x, y)
                        element_info['similarity'] = 1.0 if element_info['distance'] < 50 else 0.5
                        break
            except:
                continue

    if not element:
        return {
            "success": False,
            "error": f"No element found at ({x}, {y})",
            "elementAtPoint": None,
            "nearbyElements": [],
            "queryX": x,
            "queryY": y,
            "queryTimeMs": 0
        }

    # Get nearby elements
    nearby = []
    try:
        # Get all applications and search for elements near the point
        for app in desktop:
            try:
                _collect_nearby_elements(app, x, y, 100, nearby)
            except:
                continue
    except:
        pass

    # Sort by distance and take top 10
    nearby.sort(key=lambda e: e['distance'])
    nearby = nearby[:10]

    return {
        "success": True,
        "elementAtPoint": element_info,
        "nearbyElements": nearby,
        "queryX": x,
        "queryY": y,
        "queryTimeMs": 0
    }


def _collect_nearby_elements(element: Atspi.Accessible, x: int, y: int, max_distance: float, results: List[Dict]):
    """Recursively collect elements near a point"""
    try:
        info = get_element_info(element, x, y)
        if info['distance'] < max_distance and info['role'] != 'unknown':
            results.append(info)

        # Traverse children
        try:
            children = element.get_children()
            for child in children:
                _collect_nearby_elements(child, x, y, max_distance, results)
        except:
            pass
    except:
        pass


def search_by_keyword(keyword: str) -> Dict[str, Any]:
    """Search for elements matching keyword"""
    Atspi.init()
    desktop = Atspi.get_desktop(0)

    results = []

    for app in desktop:
        try:
            _search_element(app, keyword.lower(), results)
        except:
            continue

    # Sort by distance (prefer elements with bounds)
    results.sort(key=lambda e: e['distance'])

    return {
        "success": True,
        "results": results[:50],  # Limit to 50 results
        "searchKeyword": keyword,
        "queryTimeMs": 0
    }


def _search_element(element: Atspi.Accessible, keyword: str, results: List[Dict]):
    """Recursively search for elements matching keyword"""
    try:
        info = get_element_info(element, 0, 0)

        # Match against title, description, or value
        matches = (
            keyword in info['title'].lower() or
            keyword in info['description'].lower() or
            keyword in info['value'].lower()
        )

        if matches and info['role'] != 'unknown':
            # Set distance to 0 for search results (no position context)
            info['distance'] = 0
            results.append(info)

        # Continue searching children
        try:
            children = element.get_children()
            for child in children:
                _search_element(child, keyword, results)
        except:
            pass
    except:
        pass


def get_desktop_state() -> Dict[str, Any]:
    """Get current desktop state (windows, focused app, etc.)"""
    Atspi.init()
    desktop = Atspi.get_desktop(0)

    apps = []

    for app in desktop:
        try:
            name = app.get_name()
            if not name:
                continue

            # Get windows for this app
            windows = []
            try:
                for window in app:
                    try:
                        comp = window.queryComponent()
                        if comp:
                            extents = comp.getExtents(Atspi.CoordType.screen)
                            windows.append({
                                "title": window.get_name() or '',
                                "x": extents.x,
                                "y": extents.y,
                                "width": extents.width,
                                "height": extents.height,
                            })
                    except:
                        continue
            except:
                pass

            apps.append({
                "name": name,
                "windows": windows
            })
        except:
            continue

    # Get focused application
    focused_app = Atspi.get_focused_application()
    focused_name = focused_app.get_name() if focused_app else ''

    return {
        "success": True,
        "applications": apps,
        "focusedApplication": focused_name,
        "queryTimeMs": 0
    }


def main():
    parser = argparse.ArgumentParser(description='Linux AT-SPI2 Query Tool')
    parser.add_argument('command', choices=['query', 'search', 'state'],
                        help='Command to execute')
    parser.add_argument('x', nargs='?', type=int, help='X coordinate (for query)')
    parser.add_argument('y', nargs='?', type=int, help='Y coordinate (for query)')
    parser.add_argument('keyword', nargs='?', help='Search keyword (for search)')

    args = parser.parse_args()

    if args.command == 'query':
        if args.x is None or args.y is None:
            print(json.dumps({"success": False, "error": "x and y required for query"}))
            sys.exit(1)
        result = query_at_point(args.x, args.y)
    elif args.command == 'search':
        if not args.keyword:
            print(json.dumps({"success": False, "error": "keyword required for search"}))
            sys.exit(1)
        result = search_by_keyword(args.keyword)
    elif args.command == 'state':
        result = get_desktop_state()
    else:
        result = {"success": False, "error": "Unknown command"}

    print(json.dumps(result))


if __name__ == '__main__':
    main()
