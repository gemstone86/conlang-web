package gui;

public class Localization {

    private static final ThreadLocal<Lang> currentLang = ThreadLocal.withInitial(() -> Lang.SV);

    public static void setLang(Lang lang) {
        currentLang.set(lang);
    }

    /** Set language from a plain string — safe to call from anywhere without Lang import. */
    public static void setLangFromString(String s) {
        currentLang.set("EN".equalsIgnoreCase(s) ? Lang.EN : Lang.SV);
    }

    public static Lang getLang() {
        return currentLang.get();
    }

    public static String get(String key) {
        if (currentLang.get() == Lang.EN) return getEN(key);
        return getSV(key);
    }

    // ── Swedish ──────────────────────────────────────────────────────────

    private static String getSV(String key) {
        switch (key) {
            case "label.area":        return "Område:";
            case "label.day":         return "Dag";
            case "label.month":       return "Månad";
            case "label.year":        return "År";
            case "label.weather":     return "Väder";
            case "label.misc":        return "Övrigt";
            case "label.comment":     return "Kommentar";
            case "prompt.comment":    return "Skriv en kommentar...";
            case "button.printfile":  return "Skriv till fil";
            case "button.lang":       return "English";
            case "weather.temp":      return "Temperatur";
            case "weather.wind":      return "Vindstyrka";
            case "weather.rain":      return "Nederbörd";
            case "title":             return "Eon Vädergenerator";
            case "button.graph":      return "Dygnsgraf";
            case "day.1":			  return "Söndag";
            case "day.2":			  return "Måndag";
            case "day.3":			  return "Tisdag";
            case "day.4":			  return "Onsdag";
            case "day.5":			  return "Torsdag";
            case "day.6":			  return "Fredag";
            case "day.7":			  return "Lördag";
            case "tier.holiest":      return "Heligaste dag";
            case "tier.holy":         return "Helig dag";
            case "tier.unholy":       return "Ohelig dag";
            case "tier.unholiest":    return "Oheligaste dag";
            case "label.calendar":    return "Kalender";
            case "label.campaign":    return "Kampanj";
            case "campaign.none":     return "(ingen)";
            case "prompt.campaign":   return "Skriv kampanjanteckningar...";
            case "button.newcampaign":         return "Ny";
            case "button.renamecampaign":       return "Byt namn";
            case "button.deletecampaign":       return "Radera";
            case "dialog.newcampaign.title":    return "Ny kampanj";
            case "dialog.newcampaign.prompt":   return "Kampanjnamn:";
            case "dialog.renamecampaign.title":  return "Byt namn på kampanj";
            case "dialog.renamecampaign.prompt": return "Nytt namn:";
            case "dialog.deletecampaign.title":  return "Radera kampanj";
            case "dialog.deletecampaign.header": return "Radera kampanj";
            case "dialog.deletecampaign.merge":  return "Flytta till kommentarer";
            case "dialog.deletecampaign.delete": return "Radera";
            case "dialog.deletecampaign.cancel": return "Avbryt";
            case "cal.wk":            return "Vk";
            case "month.1":           return "Månad 1";
            case "month.2":           return "Månad 2";
            case "month.3":           return "Månad 3";
            case "month.4":           return "Månad 4";
            case "month.5":           return "Månad 5";
            case "month.6":           return "Månad 6";
            case "month.7":           return "Månad 7";
            case "month.8":           return "Månad 8";
            case "month.9":           return "Månad 9";
            case "month.10":          return "Månad 10";
            case "month.11":          return "Månad 11";
            case "month.12":          return "Månad 12";
            case "moon.phase.1":      return "Fullmåne";
            case "moon.phase.2":      return "Avtagande måne";
            case "moon.phase.3":      return "Nytändande måne";
            case "moon.phase.4":      return "Växande måne";
            default:                  return "?" + key + "?";
        }
    }

    // ── English ──────────────────────────────────────────────────────────

    private static String getEN(String key) {
        switch (key) {
            case "label.area":        return "Region:";
            case "label.day":         return "Day";
            case "label.month":       return "Month";
            case "label.year":        return "Year";
            case "label.weather":     return "Weather";
            case "label.misc":        return "Other";
            case "label.comment":     return "Comment";
            case "prompt.comment":    return "Write a comment...";
            case "button.printfile":  return "Print to file";
            case "button.lang":       return "Svenska";
            case "weather.temp":      return "Temperature";
            case "weather.wind":      return "Wind strength";
            case "weather.rain":      return "Precipitation";
            case "title":             return "Eon Weather Generator";
            case "button.graph":      return "Day Graph";
            case "day.1":			  return "Sunday";
            case "day.2":			  return "Monday";
            case "day.3":			  return "Tuseday";
            case "day.4":			  return "Wednesday";
            case "day.5":			  return "Thursday";
            case "day.6":			  return "Friday";
            case "day.7":			  return "Saturday";
            case "tier.holiest":      return "Holiest day";
            case "tier.holy":         return "Holy day";
            case "tier.unholy":       return "Unholy Day";
            case "tier.unholiest":    return "Unholies Day";
            case "label.calendar":    return "Calender";
            case "label.campaign":    return "Campaign";
            case "campaign.none":     return "(none)";
            case "prompt.campaign":   return "Write campaign notes...";
            case "button.newcampaign":         return "New";
            case "button.renamecampaign":       return "Rename";
            case "button.deletecampaign":       return "Delete";
            case "dialog.newcampaign.title":    return "New Campaign";
            case "dialog.newcampaign.prompt":   return "Campaign name:";
            case "dialog.renamecampaign.title":  return "Rename Campaign";
            case "dialog.renamecampaign.prompt": return "New name:";
            case "dialog.deletecampaign.title":  return "Delete Campaign";
            case "dialog.deletecampaign.header": return "Delete campaign";
            case "dialog.deletecampaign.merge":  return "Move to comments";
            case "dialog.deletecampaign.delete": return "Delete";
            case "dialog.deletecampaign.cancel": return "Cancel";
            case "cal.wk":            return "Wk";
            case "month.1":           return "Month 1";
            case "month.2":           return "Month 2";
            case "month.3":           return "Month 3";
            case "month.4":           return "Month 4";
            case "month.5":           return "Month 5";
            case "month.6":           return "Month 6";
            case "month.7":           return "Month 7";
            case "month.8":           return "Month 8";
            case "month.9":           return "Month 9";
            case "month.10":          return "Month 10";
            case "month.11":          return "Month 11";
            case "month.12":          return "Month 12";
            case "moon.phase.1":      return "Full moon";
            case "moon.phase.2":      return "Waning moon";
            case "moon.phase.3":      return "New moon";
            case "moon.phase.4":      return "Waxing moon";
            default:                  return "?" + key + "?";
        }
    }
}