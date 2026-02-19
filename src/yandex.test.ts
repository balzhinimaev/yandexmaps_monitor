import { parseChangeDiffValuesFromHtml } from "./yandex.js";

describe("parseChangeDiffValuesFromHtml", () => {
    it("parses old/new values from change diff html fragment", () => {
        const html = `
            <div class="CompanyChanges-ChangeDiff">
              <div class="CompanyChanges-ChangeDiffItem CompanyChanges-ChangeDiffItem_action_remove">Пн-Вс 8-20</div>
              <div class="CompanyChanges-ChangeDiffItem CompanyChanges-ChangeDiffItem_action_add">Пн-Вс 8-21,55</div>
            </div>
        `;

        expect(parseChangeDiffValuesFromHtml(html)).toEqual({
            oldValue: "Пн-Вс 8-20",
            newValue: "Пн-Вс 8-21,55",
        });
    });
});
