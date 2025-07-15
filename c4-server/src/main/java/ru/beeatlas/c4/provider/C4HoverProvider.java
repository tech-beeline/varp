package ru.beeatlas.c4.provider;

import java.util.List;
import org.eclipse.lsp4j.Hover;
import org.eclipse.lsp4j.HoverParams;
import org.eclipse.lsp4j.Position;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import ru.beeatlas.c4.utils.C4Utils;
import ru.beeatlas.c4.custom.Custom;
import ru.beeatlas.c4.model.C4DocumentModel;
import ru.beeatlas.c4.utils.LineToken;
import ru.beeatlas.c4.utils.LineTokenizer;
import ru.beeatlas.c4.utils.LineTokenizer.CursorLocation;

public class C4HoverProvider {

    private static final Logger logger = LoggerFactory.getLogger(C4HoverProvider.class);

	public C4HoverProvider() {
    }    

	public Hover calcHover(C4DocumentModel c4, HoverParams params) {
		Hover result = null;

		Position position = params.getPosition();
        int lineNumber = position.getLine();
        String line = c4.getLineAt(lineNumber);
        String scope = c4.getSurroundingScope(lineNumber);

        // if model is empy, i.e. just created
        if(C4Utils.isBlank(c4.getRawText())) {
            result = null;
        }
        else if(scope.equals(C4DocumentModel.NO_SCOPE)) {
            result = null;
        }
        else {
            List<LineToken> tokens = LineTokenizer.tokenize(line);
            CursorLocation cursorAt = LineTokenizer.cursorLocation(tokens, position.getCharacter());

            if(tokens.isEmpty() || LineTokenizer.isBeforeToken(cursorAt, 0) ) {
                result = null;
            }
            else if(LineTokenizer.isInsideToken(cursorAt, 0)) {
                result = null;
            }
            else {
                switch(scope) {
                    case "ModelDslContext":
                    case "PersonDslContext":
                    case "SoftwareSystemDslContext":
                    case "ContainerDslContext":
                    case "ComponentDslContext":
                    case "DeploymentEnvironmentDslContext":
                    case "DeploymentNodeDslContext":
                    case "InfrastructureNodeDslContext":
                    case "SoftwareSystemInstanceDslContext":
                    case "ContainerInstanceDslContext":
                    case "ViewsDslContext":
                        result = null;
                        break;
                    case "PropertiesDslContext":
                        result = Custom.getInstance().getPropertiesHover(tokens, cursorAt, position);
                        break;
                    default:                
                        result = null;
                }
            }
        }
        return result;
	}

}
