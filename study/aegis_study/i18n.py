"""Bangla and English text of the study site.

The information sheet itself is not duplicated here: the consent page renders
docs/thesis/irb/consent_<lang>.md (the text the ethics committee approves),
up to its "Consent" section. The checkboxes below must say the same as that
section.
"""
import html
import os
import re
from typing import Dict, List

LANGS = ("bn", "en")

TEXT: Dict[str, Dict[str, str]] = {
    "en": {
        "site_title": "AEGIS study shop",
        "landing_title": "Help us tell people from bots",
        "landing_body": "This is a research website of Metropolitan University, Sylhet. "
                        "It takes about 10–15 minutes. You need the study code the researcher gave you.",
        "choose_lang": "Choose a language",
        "consent_title": "Information and consent",
        "draft_warning": "DRAFT: this information sheet still has unfilled fields. Do not use it with participants "
                         "before the ethics committee has approved it.",
        "consent_read": "I have read the information above and could ask questions.",
        "consent_aggregate": "I understand that summary numbers about how I use this website are recorded, "
                             "not what I type.",
        "consent_withdraw": "I understand that I can stop at any time and ask for my data to be deleted.",
        "consent_age": "I am 18 years or older and agree to take part.",
        "consent_raw_title": "Optional",
        "consent_raw": "I also agree that the timing of my individual mouse movements, key presses and scrolling "
                       "is recorded (positions and times only; never which key or what I type). "
                       "This helps the research a lot, but you can take part without it.",
        "code_label": "Study code",
        "code_hint": "For example H-ABCD2345",
        "start": "Start",
        "consent_missing": "Please tick all four required boxes to take part.",
        "code_invalid": "This study code is not valid. Please check it with the researcher.",
        "too_many": "Too many attempts. Please wait a few minutes and try again.",
        "survey_pre_title": "A few questions before you start",
        "survey_post_title": "Last questions",
        "survey_optional": "All questions are optional.",
        "next": "Continue",
        "prefer_not": "Prefer not to say",
        "q_age": "Your age group",
        "q_device": "What are you using right now?",
        "o_desktop": "Desktop computer", "o_laptop": "Laptop", "o_phone": "Phone", "o_tablet": "Tablet",
        "q_input": "How do you point and click right now?",
        "o_mouse": "Mouse", "o_touchpad": "Touchpad", "o_touch": "Touch screen", "o_other": "Other",
        "q_usage": "How often do you use a computer or smartphone browser?",
        "o_daily": "Every day", "o_weekly": "A few times a week", "o_rarely": "Rarely",
        "q_typing": "Which keyboard do you usually type with?",
        "o_english": "English", "o_bangla": "Bangla", "o_both": "Both",
        "q_hand": "Which hand do you use for the mouse or screen?",
        "o_right": "Right", "o_left": "Left", "o_both_hands": "Both",
        "q_autofill": "Did your browser or a password manager fill in any field for you?",
        "o_yes": "Yes", "o_no": "No", "o_unsure": "Not sure",
        "q_tools": "Did you use any tool that clicks or types automatically (e.g. an extension or macro)?",
        "q_assistive": "Did you use an assistive tool (screen reader, magnifier, voice control)?",
        "q_interrupted": "Were you interrupted or distracted during the tasks?",
        "q_difficulty": "How easy were the tasks?",
        "o_1": "Very easy", "o_2": "Easy", "o_3": "OK", "o_4": "Hard", "o_5": "Very hard",
        "done_title": "Thank you!",
        "done_body": "You have finished. Your study code is {code}. Keep it if you might want your data deleted "
                     "later: give it to the researcher.",
        "task": "Task", "of": "of",
        "skip": "Skip this task",
        "skip_confirm": "Skip this task?",
        "all_done": "All tasks are done.",
        "finish": "Finish",
        "t_login": "Log in with username <b>{username}</b> and password <b>{password}</b>.",
        "t_search": "Use the search box to search for <b>{search_term}</b>, then open that product.",
        "t_compare": "In the category <b>{category}</b>, find the <b>cheapest</b> product with a rating of "
                     "<b>4.0 or more</b> and add it to your cart.",
        "t_cart": "Open your cart. Set the quantity of the product you just added to <b>{quantity}</b> and "
                  "remove <b>{decoy}</b> from the cart.",
        "t_checkout": "Go to checkout and enter these delivery details: <b>{name}</b>, phone <b>{phone}</b>, "
                      "<b>{address}</b>, <b>{city}</b> {postcode}, <b>{option}</b> delivery. In the note, write "
                      "one sentence of your own about when you would like the delivery.",
        "t_review": "Write a short review (one or two sentences, in your own words) of <b>{product}</b> and give it "
                    "a star rating.",
        "login_title": "Log in", "username": "Username", "password": "Password", "login": "Log in",
        "login_failed": "Username or password is not correct.",
        "search_placeholder": "Search products", "search": "Search", "results": "Results for your search",
        "no_results": "No products found.", "categories": "Categories", "rating": "Rating",
        "reviews": "reviews", "add_to_cart": "Add to cart", "added": "Added to your cart.",
        "cart": "Cart", "cart_empty": "Your cart is empty.", "quantity": "Quantity", "update": "Update",
        "remove": "Remove", "total": "Total", "checkout": "Checkout",
        "full_name": "Full name", "phone": "Phone", "address": "Address", "city": "City", "postcode": "Postcode",
        "delivery": "Delivery", "standard": "Standard", "express": "Express", "note": "Delivery note",
        "place_order": "Place order", "fix_fields": "Some details do not match the task. Please check: {fields}",
        "order_placed": "Order placed (this is a test shop, nothing is delivered).",
        "review_title": "Write a review", "your_review": "Your review", "stars": "Stars", "submit": "Submit",
        "review_short": "Please write at least one full sentence and choose a star rating.",
        "review_saved": "Thank you for the review.",
        "logged_in_as": "Logged in as {user}",
        "home": "Home",
        "not_in_study": "Please start from the study's first page.",
    },
    "bn": {
        "site_title": "AEGIS গবেষণা শপ",
        "landing_title": "মানুষ আর বট আলাদা করতে আমাদের সাহায্য করুন",
        "landing_body": "এটি মেট্রোপলিটন ইউনিভার্সিটি, সিলেটের একটি গবেষণা ওয়েবসাইট। "
                        "সময় লাগবে প্রায় ১০–১৫ মিনিট। গবেষকের দেওয়া স্টাডি কোড লাগবে।",
        "choose_lang": "ভাষা বেছে নিন",
        "consent_title": "তথ্য ও সম্মতি",
        "draft_warning": "খসড়া: এই তথ্যপত্রের কিছু ঘর এখনো পূরণ হয়নি। নৈতিকতা কমিটির অনুমোদনের আগে "
                         "অংশগ্রহণকারীদের সাথে এটি ব্যবহার করবেন না।",
        "consent_read": "আমি উপরের তথ্য পড়েছি এবং প্রশ্ন করার সুযোগ পেয়েছি।",
        "consent_aggregate": "আমি বুঝেছি যে এই ওয়েবসাইট ব্যবহারের সারসংক্ষেপ সংখ্যা রেকর্ড হবে, "
                             "আমি কী লিখছি তা নয়।",
        "consent_withdraw": "আমি বুঝেছি যে আমি যেকোনো সময় থামতে পারি এবং আমার ডেটা মুছে ফেলতে বলতে পারি।",
        "consent_age": "আমার বয়স ১৮ বছর বা তার বেশি এবং আমি অংশ নিতে সম্মত।",
        "consent_raw_title": "ঐচ্ছিক",
        "consent_raw": "আমি এতেও সম্মত যে আমার প্রতিটি মাউস নড়াচড়া, কী চাপা ও স্ক্রলের সময় রেকর্ড হবে "
                       "(শুধু অবস্থান ও সময়; কোন কী বা কী লিখছি তা কখনো নয়)। "
                       "এটি গবেষণায় অনেক সাহায্য করে, তবে এতে সম্মতি না দিয়েও অংশ নেওয়া যায়।",
        "code_label": "স্টাডি কোড",
        "code_hint": "যেমন H-ABCD2345",
        "start": "শুরু করুন",
        "consent_missing": "অংশ নিতে আবশ্যক চারটি ঘরেই টিক দিন।",
        "code_invalid": "এই স্টাডি কোডটি সঠিক নয়। গবেষকের সাথে মিলিয়ে নিন।",
        "too_many": "অনেকবার চেষ্টা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন।",
        "survey_pre_title": "শুরু করার আগে কয়েকটি প্রশ্ন",
        "survey_post_title": "শেষ কয়েকটি প্রশ্ন",
        "survey_optional": "সব প্রশ্নের উত্তর দেওয়া ঐচ্ছিক।",
        "next": "এগিয়ে যান",
        "prefer_not": "বলতে চাই না",
        "q_age": "আপনার বয়সসীমা",
        "q_device": "এখন আপনি কী ব্যবহার করছেন?",
        "o_desktop": "ডেস্কটপ কম্পিউটার", "o_laptop": "ল্যাপটপ", "o_phone": "ফোন", "o_tablet": "ট্যাবলেট",
        "q_input": "এখন কী দিয়ে পয়েন্ট ও ক্লিক করছেন?",
        "o_mouse": "মাউস", "o_touchpad": "টাচপ্যাড", "o_touch": "টাচ স্ক্রিন", "o_other": "অন্য কিছু",
        "q_usage": "কম্পিউটার বা স্মার্টফোনের ব্রাউজার কত ঘন ঘন ব্যবহার করেন?",
        "o_daily": "প্রতিদিন", "o_weekly": "সপ্তাহে কয়েকবার", "o_rarely": "কদাচিৎ",
        "q_typing": "সাধারণত কোন কিবোর্ডে লেখেন?",
        "o_english": "ইংরেজি", "o_bangla": "বাংলা", "o_both": "দুটোই",
        "q_hand": "মাউস বা স্ক্রিনে কোন হাত ব্যবহার করেন?",
        "o_right": "ডান", "o_left": "বাম", "o_both_hands": "দুই হাতই",
        "q_autofill": "আপনার ব্রাউজার বা পাসওয়ার্ড ম্যানেজার কি কোনো ঘর নিজে থেকে পূরণ করেছে?",
        "o_yes": "হ্যাঁ", "o_no": "না", "o_unsure": "নিশ্চিত নই",
        "q_tools": "আপনি কি এমন কোনো টুল ব্যবহার করেছেন যা নিজে থেকে ক্লিক করে বা লেখে (যেমন এক্সটেনশন বা ম্যাক্রো)?",
        "q_assistive": "আপনি কি কোনো সহায়ক টুল (স্ক্রিন রিডার, ম্যাগনিফায়ার, ভয়েস কন্ট্রোল) ব্যবহার করেছেন?",
        "q_interrupted": "কাজের সময় কি আপনার মনোযোগ ভেঙেছে বা কেউ বাধা দিয়েছে?",
        "q_difficulty": "কাজগুলো কতটা সহজ ছিল?",
        "o_1": "খুব সহজ", "o_2": "সহজ", "o_3": "মোটামুটি", "o_4": "কঠিন", "o_5": "খুব কঠিন",
        "done_title": "ধন্যবাদ!",
        "done_body": "আপনি শেষ করেছেন। আপনার স্টাডি কোড {code}। পরে ডেটা মুছতে চাইলে কোডটি গবেষককে দিন, "
                     "তাই এটি রেখে দিন।",
        "task": "কাজ", "of": "এর মধ্যে",
        "skip": "এই কাজটি বাদ দিন",
        "skip_confirm": "এই কাজটি বাদ দেবেন?",
        "all_done": "সব কাজ শেষ।",
        "finish": "শেষ করুন",
        "t_login": "ইউজারনেম <b>{username}</b> আর পাসওয়ার্ড <b>{password}</b> দিয়ে লগইন করুন।",
        "t_search": "সার্চ বক্সে <b>{search_term}</b> লিখে খুঁজুন, তারপর পণ্যটি খুলুন।",
        "t_compare": "<b>{category}</b> বিভাগে <b>৪.০ বা তার বেশি</b> রেটিংয়ের মধ্যে <b>সবচেয়ে কম দামের</b> "
                     "পণ্যটি খুঁজে কার্টে যোগ করুন।",
        "t_cart": "কার্ট খুলুন। এইমাত্র যোগ করা পণ্যের পরিমাণ <b>{quantity}</b> করুন এবং কার্ট থেকে "
                  "<b>{decoy}</b> সরিয়ে দিন।",
        "t_checkout": "চেকআউটে গিয়ে এই ডেলিভারি তথ্য লিখুন: <b>{name}</b>, ফোন <b>{phone}</b>, "
                      "<b>{address}</b>, <b>{city}</b> {postcode}, <b>{option}</b> ডেলিভারি। নোটে নিজের ভাষায় "
                      "এক বাক্যে লিখুন কখন ডেলিভারি চান (ইংরেজি অক্ষরে)।",
        "t_review": "<b>{product}</b> নিয়ে নিজের ভাষায় ছোট একটি রিভিউ লিখুন (এক-দুই বাক্য, ইংরেজি অক্ষরে) "
                    "এবং স্টার রেটিং দিন।",
        "login_title": "লগইন", "username": "ইউজারনেম", "password": "পাসওয়ার্ড", "login": "লগইন",
        "login_failed": "ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।",
        "search_placeholder": "পণ্য খুঁজুন", "search": "খুঁজুন", "results": "আপনার খোঁজের ফলাফল",
        "no_results": "কোনো পণ্য পাওয়া যায়নি।", "categories": "বিভাগ", "rating": "রেটিং",
        "reviews": "রিভিউ", "add_to_cart": "কার্টে যোগ করুন", "added": "কার্টে যোগ হয়েছে।",
        "cart": "কার্ট", "cart_empty": "আপনার কার্ট খালি।", "quantity": "পরিমাণ", "update": "হালনাগাদ",
        "remove": "সরান", "total": "মোট", "checkout": "চেকআউট",
        "full_name": "পুরো নাম", "phone": "ফোন", "address": "ঠিকানা", "city": "শহর", "postcode": "পোস্টকোড",
        "delivery": "ডেলিভারি", "standard": "স্ট্যান্ডার্ড", "express": "এক্সপ্রেস", "note": "ডেলিভারি নোট",
        "place_order": "অর্ডার দিন", "fix_fields": "কিছু তথ্য কাজের সাথে মিলছে না। দেখে নিন: {fields}",
        "order_placed": "অর্ডার হয়েছে (এটি পরীক্ষামূলক শপ, কিছু ডেলিভারি হবে না)।",
        "review_title": "রিভিউ লিখুন", "your_review": "আপনার রিভিউ", "stars": "স্টার", "submit": "জমা দিন",
        "review_short": "অন্তত একটি পূর্ণ বাক্য লিখুন এবং স্টার রেটিং দিন।",
        "review_saved": "রিভিউয়ের জন্য ধন্যবাদ।",
        "logged_in_as": "{user} হিসেবে লগইন",
        "home": "হোম",
        "not_in_study": "অনুগ্রহ করে গবেষণার প্রথম পাতা থেকে শুরু করুন।",
    },
}

AGE_GROUPS = ["18-24", "25-34", "35-44", "45-54", "55+"]

#: Survey questions: key -> (text key, option keys). Answers are stored as option keys only.
SURVEY = {
    "pre": [
        ("age", "q_age", AGE_GROUPS),
        ("device", "q_device", ["desktop", "laptop", "phone", "tablet"]),
        ("input", "q_input", ["mouse", "touchpad", "touch", "other"]),
        ("usage", "q_usage", ["daily", "weekly", "rarely"]),
        ("typing", "q_typing", ["english", "bangla", "both"]),
        ("hand", "q_hand", ["right", "left", "both_hands"]),
    ],
    "post": [
        ("autofill", "q_autofill", ["yes", "no", "unsure"]),
        ("tools", "q_tools", ["yes", "no", "unsure"]),
        ("assistive", "q_assistive", ["yes", "no"]),
        ("interrupted", "q_interrupted", ["yes", "no"]),
        ("difficulty", "q_difficulty", ["1", "2", "3", "4", "5"]),
    ],
}


def t(lang: str, key: str, **values: str) -> str:
    text = TEXT.get(lang, TEXT["en"]).get(key) or TEXT["en"].get(key, key)
    return text.format(**values) if values else text


def option_label(lang: str, option: str) -> str:
    return option if option in AGE_GROUPS else t(lang, f"o_{option}")


# -- consent document ------------------------------------------------------------

def consent_dir() -> str:
    return os.getenv("STUDY_CONSENT_DIR") or os.path.join(
        os.path.dirname(__file__), "..", "..", "docs", "thesis", "irb")


def _inline(text: str) -> str:
    text = html.escape(text)
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)


def consent_html(lang: str) -> Dict[str, object]:
    """The information sheet (consent_<lang>.md up to its consent section) as HTML, and whether it is a draft."""
    path = os.path.join(consent_dir(), f"consent_{lang}.md")
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    out: List[str] = []
    paragraph: List[str] = []
    in_list = False

    def flush() -> None:
        nonlocal in_list
        if paragraph:
            out.append("<p>" + "<br>".join(_inline(p) for p in paragraph) + "</p>")
            paragraph.clear()
        if in_list:
            out.append("</ul>")
            in_list = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## ") and stripped[3:].strip().lower() in ("consent", "সম্মতি"):
            break  # the checkboxes are rendered by the form
        if stripped.startswith(">") or stripped == "---" or stripped.startswith("# "):
            flush()  # draft notes, rules and the document title are not shown
            continue
        if stripped.startswith("## "):
            flush()
            out.append(f"<h2>{_inline(stripped[3:])}</h2>")
        elif stripped.startswith("- "):
            if paragraph:
                flush()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_inline(stripped[2:])}</li>")
        elif not stripped:
            flush()
        else:
            if in_list:
                flush()
            paragraph.append(stripped)
    flush()
    body = "\n".join(out)
    return {"html": body, "draft": bool(re.search(r"\[[^\]]+\]", body))}
